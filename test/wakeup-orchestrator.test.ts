import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import {
  Vpc,
  Instance,
  InstanceType,
  InstanceClass,
  InstanceSize,
  MachineImage,
} from 'aws-cdk-lib/aws-ec2';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { WakeupOrchestrator } from '../lib/constructs/wakeup-orchestrator.js';

describe('WakeupOrchestrator Construct', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestOrchestratorStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });

  const vpc = new Vpc(stack, 'TestVpc', { maxAzs: 1 });
  const instance = new Instance(stack, 'TestInstance', {
    vpc,
    instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
    machineImage: MachineImage.latestAmazonLinux2023(),
  });
  const inboxBucket = new Bucket(stack, 'TestInboxBucket');
  const kvsArn = 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs-123';

  const orchestrator = new WakeupOrchestrator(stack, 'Orchestrator', {
    instance,
    inboxBucket,
    kvsArn,
  });

  const template = Template.fromStack(stack);

  it('exposes wakeupFunction and functionUrl public properties', () => {
    expect(orchestrator.wakeupFunction).toBeDefined();
    expect(orchestrator.functionUrl).toBeDefined();
  });

  it('provisions Wakeup Lambda with 256MB memory, 30s timeout, nodejs22.x and environment variables', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      Timeout: 30,
      MemorySize: 256,
      Environment: {
        Variables: {
          INSTANCE_ID: {
            Ref: Match.stringLikeRegexp('TestInstance.*'),
          },
          KVS_ARN: kvsArn,
        },
      },
    });
  });

  it('configures IAM role with least-privilege EC2 and CloudFront KeyValueStore permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ec2:DescribeInstances',
            Effect: 'Allow',
            Resource: '*',
          }),
          Match.objectLike({
            Action: 'ec2:StartInstances',
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                '',
                [
                  'arn:aws:ec2:*:*:instance/',
                  {
                    Ref: Match.stringLikeRegexp('TestInstance.*'),
                  },
                ],
              ],
            },
          }),
          Match.objectLike({
            Action: [
              'cloudfront-keyvaluestore:DescribeKeyValueStore',
              'cloudfront-keyvaluestore:PutKey',
              'cloudfront-keyvaluestore:GetKey',
            ],
            Effect: 'Allow',
            Resource: kvsArn,
          }),
        ]),
      },
    });
  });

  it('configures Lambda Function URL with AuthType NONE and open CORS', () => {
    template.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'NONE',
      Cors: {
        AllowHeaders: ['*'],
        AllowMethods: ['*'],
        AllowOrigins: ['*'],
      },
    });
  });

  it('attaches S3 ObjectCreated event notification under consume/ prefix', () => {
    template.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: {
        LambdaFunctionConfigurations: Match.arrayWith([
          Match.objectLike({
            Events: ['s3:ObjectCreated:*'],
            Filter: {
              Key: {
                FilterRules: [
                  {
                    Name: 'prefix',
                    Value: 'consume/',
                  },
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it('creates EventBridge Rule for EC2 state transitions stopping, stopped, shutting-down', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Description: 'Notifies Wakeup Lambda when Paperless EC2 instance stops',
      EventPattern: {
        source: ['aws.ec2'],
        'detail-type': ['EC2 Instance State-change Notification'],
        detail: {
          'instance-id': [
            {
              Ref: Match.stringLikeRegexp('TestInstance.*'),
            },
          ],
          state: ['stopping', 'stopped', 'shutting-down'],
        },
      },
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: {
            'Fn::GetAtt': [Match.stringLikeRegexp('OrchestratorWakeupHandler.*'), 'Arn'],
          },
        }),
      ]),
    });
  });
});
