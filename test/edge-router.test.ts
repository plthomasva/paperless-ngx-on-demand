import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { KeyValueStore } from 'aws-cdk-lib/aws-cloudfront';
import {
  Function as LambdaFunction,
  Runtime,
  Code,
  FunctionUrlAuthType,
} from 'aws-cdk-lib/aws-lambda';
import { EdgeRouter } from '../lib/constructs/edge-router.js';

describe('EdgeRouter Construct', () => {
  it('provisions CloudFront distribution and router function without custom domain', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestEdgeStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const lambdaFn = new LambdaFunction(stack, 'DummyFn', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => {};'),
    });
    const functionUrl = lambdaFn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
    const kvs = new KeyValueStore(stack, 'TestKvs');

    const router = new EdgeRouter(stack, 'EdgeRouter', {
      wakeupFunctionUrl: functionUrl,
      originVerifySecret: 'secret-token-12345',
      keyValueStore: kvs,
    });

    expect(router.distribution).toBeDefined();
    expect(router.routerFunction).toBeDefined();

    const template = Template.fromStack(stack);

    // Verify CloudFront Function code and configuration
    template.hasResourceProperties('AWS::CloudFront::Function', {
      Name: Match.anyValue(),
      FunctionConfig: {
        Comment: 'Dynamic origin router checking KVS for warm Paperless-NGX instance',
        Runtime: 'cloudfront-js-2.0',
        KeyValueStoreAssociations: Match.arrayWith([
          Match.objectLike({
            KeyValueStoreARN: {
              'Fn::GetAtt': [Match.stringLikeRegexp('TestKvs.*'), 'Arn'],
            },
          }),
        ]),
      },
      FunctionCode: Match.stringLikeRegexp(
        "[\\s\\S]*x-forwarded-host[\\s\\S]*__wakeup[\\s\\S]*updateRequestOrigin[\\s\\S]*port: 8000[\\s\\S]*protocol: 'http'[\\s\\S]*"
      ),
    });

    // Verify CloudFront Distribution default behavior
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Comment: 'Paperless-NGX On-Demand Distribution',
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
          FunctionAssociations: [
            {
              EventType: 'viewer-request',
              FunctionARN: {
                'Fn::GetAtt': [
                  Match.stringLikeRegexp('EdgeRouterDynamicOriginRouter.*'),
                  'FunctionARN',
                ],
              },
            },
          ],
        }),
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.objectLike({
              HTTPPort: 8000,
              OriginProtocolPolicy: 'match-viewer',
            }),
            OriginCustomHeaders: [
              {
                HeaderName: 'x-origin-verify',
                HeaderValue: 'secret-token-12345',
              },
            ],
          }),
        ]),
      }),
    });

    // Proves no certificate is created when domainName is omitted
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
  });

  it('provisions ACM certificate with DNS validation when custom domain is provided without certificateArn', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestCustomDomainStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const lambdaFn = new LambdaFunction(stack, 'DummyFn2', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => {};'),
    });
    const functionUrl = lambdaFn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
    const kvs = new KeyValueStore(stack, 'TestKvs2');

    new EdgeRouter(stack, 'EdgeRouter', {
      wakeupFunctionUrl: functionUrl,
      originVerifySecret: 'secret-token-12345',
      keyValueStore: kvs,
      domainName: 'paperless.example.com',
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'paperless.example.com',
      ValidationMethod: 'DNS',
    });

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['paperless.example.com'],
        ViewerCertificate: Match.objectLike({
          AcmCertificateArn: {
            Ref: Match.stringLikeRegexp('EdgeRouterCustomDomainCert.*'),
          },
          SslSupportMethod: 'sni-only',
        }),
      }),
    });
  });

  it('reuses existing certificateArn when provided with custom domain', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestExistingCertStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const lambdaFn = new LambdaFunction(stack, 'DummyFn3', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => {};'),
    });
    const functionUrl = lambdaFn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
    const kvs = new KeyValueStore(stack, 'TestKvs3');

    const certArn =
      'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012';

    new EdgeRouter(stack, 'EdgeRouter', {
      wakeupFunctionUrl: functionUrl,
      originVerifySecret: 'secret-token-12345',
      keyValueStore: kvs,
      domainName: 'paperless.example.com',
      certificateArn: certArn,
    });

    const template = Template.fromStack(stack);

    // ZERO new certificates created
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['paperless.example.com'],
        ViewerCertificate: Match.objectLike({
          AcmCertificateArn: certArn,
          SslSupportMethod: 'sni-only',
        }),
      }),
    });
  });
});
