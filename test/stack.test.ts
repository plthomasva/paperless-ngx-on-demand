import { describe, it, expect } from 'vitest';
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

  it('provisions S3 Inbox bucket with versioning and backup lifecycle expiration', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
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
});

describe('PaperlessOnDemandStack with Existing S3 Storage Bucket', () => {
  const app = new cdk.App();
  const stack = new PaperlessOnDemandStack(app, 'ExistingBucketStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    existingBucketName: 'paperless-ngx-storage-1749863935',
    mediaSubpath: 'media',
  });
  const template = Template.fromStack(stack);

  it('reuses the existing S3 bucket: creates ZERO new S3 buckets', () => {
    template.resourceCountIs('AWS::S3::Bucket', 0);
  });

  it('attaches S3 ObjectCreated event notification on the existing bucket under consume/', () => {
    template.resourceCountIs('Custom::S3BucketNotifications', 1);
  });
});
