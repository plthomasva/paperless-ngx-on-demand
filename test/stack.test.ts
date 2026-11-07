import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PaperlessOnDemandStack } from '../lib/paperless-on-demand-stack.js';

describe('PaperlessOnDemandStack Architecture Guardrails', () => {
  const app = new cdk.App();
  const stack = new PaperlessOnDemandStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    adminUser: 'testadmin',
    adminEmail: 'test@example.com',
  });
  const template = Template.fromStack(stack);

  it('proves zero-cost compute idle: provisions ZERO NAT Gateways', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('proves zero-cost compute idle: provisions ZERO Application Load Balancers', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
  });

  it('proves zero-cost compute idle: provisions ZERO RDS instances', () => {
    template.resourceCountIs('AWS::RDS::DBInstance', 0);
  });

  it('proves zero-cost compute idle: provisions ZERO ElastiCache clusters', () => {
    template.resourceCountIs('AWS::ElastiCache::CacheCluster', 0);
  });

  it('provisions a single public VPC with a free S3 Gateway Endpoint', () => {
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: {
        'Fn::Join': ['', ['com.amazonaws.', { Ref: 'AWS::Region' }, '.s3']],
      },
      VpcEndpointType: 'Gateway',
    });
  });

  it('provisions EC2 t4g.medium instance with encrypted gp3 root volume', () => {
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.medium',
      BlockDeviceMappings: Match.arrayWith([
        Match.objectLike({
          DeviceName: '/dev/xvda',
          Ebs: {
            VolumeSize: 10,
            VolumeType: 'gp3',
            Encrypted: true,
            DeleteOnTermination: false,
          },
        }),
      ]),
    });
  });

  it('provisions CloudFront KeyValueStore, Function, and Distribution', () => {
    template.resourceCountIs('AWS::CloudFront::KeyValueStore', 1);
    template.resourceCountIs('AWS::CloudFront::Function', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);

    // Verify CloudFront Function uses runtime cloudfront-js-2.0
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionConfig: Match.objectLike({
        Runtime: 'cloudfront-js-2.0',
      }),
    });
  });

  it('provisions conflict-free account-and-region namespaced S3 bucket with versioning', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'paperless-storage-123456789012-us-east-1-an',
      BucketNamespace: 'account-regional',
      VersioningConfiguration: {
        Status: 'Enabled',
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Id: 'ExpireOldBackups',
            Status: 'Enabled',
            ExpirationInDays: 60,
          }),
        ]),
      },
    });
  });

  it('provisions Wakeup Lambda with Function URL and EventBridge rule', () => {
    // Verifies our Wakeup Lambda is created and has the Function URL attached
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 30,
    });
    template.resourceCountIs('AWS::Lambda::Url', 1);
    template.resourceCountIs('AWS::Events::Rule', 1);
  });

  it('provisions S3 bucket deployment to sync runtime scripts automatically on deploy', () => {
    template.resourceCountIs('Custom::CDKBucketDeployment', 1);
  });

  it('provisions CloudFormation outputs with descriptions and values', () => {
    template.hasOutput('PaperlessUrl', {
      Description: 'Public URL for Paperless-NGX (Point your browser here)',
    });
    template.hasOutput('CloudFrontUrl', {
      Description: 'CloudFront distribution default domain',
    });
    template.hasOutput('S3StorageBucket', {
      Description: 'Unified S3 storage bucket for media, drop ingestion (/consume), and backups',
    });
    template.hasOutput('InstanceId', {
      Description: 'EC2 Instance ID for Paperless-NGX',
    });
    template.hasOutput('KvsArn', {
      Description: 'CloudFront KeyValueStore ARN for edge state',
    });
  });

  it('instantiates default stack with no props', () => {
    const customApp = new cdk.App();
    const customStack = new PaperlessOnDemandStack(customApp, 'NoPropsStack');
    const customTemplate = Template.fromStack(customStack);
    customTemplate.resourceCountIs('AWS::EC2::VPC', 1);
  });

  it('supports existingMediaBucketName backwards compatibility alias', () => {
    const customApp = new cdk.App();
    const customStack = new PaperlessOnDemandStack(customApp, 'MediaBucketStack', {
      existingMediaBucketName: 'legacy-media-bucket',
    });
    const customTemplate = Template.fromStack(customStack);
    customTemplate.resourceCountIs('AWS::S3::Bucket', 0);
  });

  it('passes explicit originVerifySecret when specified', () => {
    const customApp = new cdk.App();
    const customStack = new PaperlessOnDemandStack(customApp, 'CustomSecretStack', {
      originVerifySecret: 'my-custom-verify-secret-12345',
    });
    const customTemplate = Template.fromStack(customStack);
    customTemplate.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            OriginCustomHeaders: Match.arrayWith([
              Match.objectLike({
                HeaderName: 'x-origin-verify',
                HeaderValue: 'my-custom-verify-secret-12345',
              }),
            ]),
          }),
        ]),
      }),
    });
  });
});

describe('PaperlessOnDemandStack with Existing S3 Storage Bucket', () => {
  const app = new cdk.App();
  const stack = new PaperlessOnDemandStack(app, 'ExistingBucketStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    existingBucketName: 'existing-paperless-storage-bucket',
    mediaSubpath: 'media',
    domainName: 'paperless.example.com',
  });
  const template = Template.fromStack(stack);

  it('reuses the existing S3 bucket: creates ZERO new S3 buckets', () => {
    template.resourceCountIs('AWS::S3::Bucket', 0);
  });

  it('attaches S3 ObjectCreated event notification on the existing bucket under consume/', () => {
    template.resourceCountIs('Custom::S3BucketNotifications', 1);
  });

  it('provisions ACM certificate and attaches custom domain alias to CloudFront', () => {
    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'paperless.example.com',
      ValidationMethod: 'DNS',
    });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['paperless.example.com'],
      }),
    });
  });
});
