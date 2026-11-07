import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { ComputeInstance } from '../lib/constructs/compute-instance.js';

describe('ComputeInstance Construct', () => {
  it('provisions EC2 instance with default configurations and user-data', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestComputeStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const vpc = new Vpc(stack, 'TestVpc', { maxAzs: 1 });
    const mediaBucket = new Bucket(stack, 'TestMediaBucket');
    const inboxBucket = new Bucket(stack, 'TestInboxBucket');
    const kvsArn = 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs';
    const originVerifySecret = 'test-origin-verify-secret';

    const compute = new ComputeInstance(stack, 'Compute', {
      vpc,
      mediaBucket,
      inboxBucket,
      kvsArn,
      originVerifySecret,
    });

    expect(compute.instance).toBeDefined();
    expect(compute.securityGroup).toBeDefined();
    expect(compute.role).toBeDefined();

    const template = Template.fromStack(stack);

    // 1. Role & Policies
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'ec2.amazonaws.com',
            },
          },
        ],
      },
      Description: 'IAM role for Paperless-NGX EC2 instance with S3, KVS, and SSM permissions',
      ManagedPolicyArns: [
        {
          'Fn::Join': [
            '',
            ['arn:', { Ref: 'AWS::Partition' }, ':iam::aws:policy/AmazonSSMManagedInstanceCore'],
          ],
        },
      ],
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
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

    // 2. Security Group with default CloudFront Managed Prefix List pl-3b927c52
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Allow inbound traffic to Paperless activity proxy from CloudFront only',
      SecurityGroupEgress: [
        {
          CidrIp: '0.0.0.0/0',
          Description: 'Allow all outbound traffic by default',
          IpProtocol: '-1',
        },
      ],
    });

    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      Description: 'Allow HTTP on port 8000 from CloudFront edge origins',
      FromPort: 8000,
      IpProtocol: 'tcp',
      SourcePrefixListId: 'pl-3b927c52',
      ToPort: 8000,
    });

    // 3. EC2 Instance configuration
    template.hasResourceProperties('AWS::EC2::Instance', {
      InstanceType: 't4g.medium',
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/xvda',
          Ebs: {
            DeleteOnTermination: false,
            Encrypted: true,
            VolumeSize: 10,
            VolumeType: 'gp3',
          },
        },
      ],
    });

    // 4. Assert UserData lines
    const userData = compute.instance.userData.render();
    expect(userData).toContain('set -xeuo pipefail');
    expect(userData).toContain('dnf update -y');
    expect(userData).toContain('dnf install -y docker mount-s3 aws-cli sqlite tar gzip');
    expect(userData).toContain('user_allow_other');
    expect(userData).toContain('systemctl enable docker');
    expect(userData).toContain('systemctl start docker');
    expect(userData).toContain('docker-compose-linux-aarch64');
    expect(userData).toContain(
      'mkdir -p /opt/paperless/runtime /mnt/data /mnt/paperless-media /mnt/consume /mnt/export /tmp/paperless'
    );
    expect(userData).toContain('MEDIA_SUBPATH=media');
    expect(userData).toContain('DOMAIN_NAME=localhost');
    expect(userData).toContain('PAPERLESS_URL=https://localhost');
    expect(userData).toContain(
      'PAPERLESS_CSRF_TRUSTED_ORIGINS=https://localhost,https://*.localhost,https://*.cloudfront.net,https://localhost,http://localhost'
    );
    expect(userData).toContain('PAPERLESS_ADMIN_USER=admin');
    expect(userData).toContain('PAPERLESS_ADMIN_PASSWORD=admin');
    expect(userData).toContain('PAPERLESS_ADMIN_EMAIL=admin@example.com');
    expect(userData).toContain('AWS_REGION=us-east-1');
    expect(userData).toContain('paperless-boot.service');
    expect(userData).toContain('paperless-watchdog.service');
    expect(userData).toContain(
      'systemctl enable paperless-boot.service paperless-watchdog.service'
    );
  });

  it('supports custom props: custom prefix list, custom domain name with domain split, and custom credentials', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestComputeCustomStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const vpc = new Vpc(stack, 'TestVpc2', { maxAzs: 1 });
    const mediaBucket = new Bucket(stack, 'TestMediaBucket2');
    const inboxBucket = new Bucket(stack, 'TestInboxBucket2');
    const kvsArn = 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs';
    const originVerifySecret = 'test-secret';

    const compute = new ComputeInstance(stack, 'ComputeCustom', {
      vpc,
      mediaBucket,
      inboxBucket,
      kvsArn,
      originVerifySecret,
      cloudfrontPrefixListId: 'pl-custom-999',
      mediaSubpath: 'custom-subpath',
      domainName: 'pod.painless-computing.com',
      adminUser: 'customadmin',
      adminPassword: 'custompassword',
      adminEmail: 'custom@example.com',
    });

    const template = Template.fromStack(stack);

    // Ingress with custom prefix list
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      Description: 'Allow HTTP on port 8000 from CloudFront edge origins',
      FromPort: 8000,
      IpProtocol: 'tcp',
      SourcePrefixListId: 'pl-custom-999',
      ToPort: 8000,
    });

    // UserData with custom values and domain splitting
    const userData = compute.instance.userData.render();
    expect(userData).toContain('MEDIA_SUBPATH=custom-subpath');
    expect(userData).toContain('DOMAIN_NAME=pod.painless-computing.com');
    expect(userData).toContain('PAPERLESS_URL=https://pod.painless-computing.com');
    expect(userData).toContain(
      'PAPERLESS_CSRF_TRUSTED_ORIGINS=https://pod.painless-computing.com,https://*.painless-computing.com,https://*.cloudfront.net,https://localhost,http://localhost'
    );
    expect(userData).toContain('PAPERLESS_ADMIN_USER=customadmin');
    expect(userData).toContain('PAPERLESS_ADMIN_PASSWORD=custompassword');
    expect(userData).toContain('PAPERLESS_ADMIN_EMAIL=custom@example.com');
  });

  it('handles domainName without dots correctly in CSRF origins', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestComputeSimpleDomainStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const vpc = new Vpc(stack, 'TestVpc3', { maxAzs: 1 });
    const mediaBucket = new Bucket(stack, 'TestMediaBucket3');
    const inboxBucket = new Bucket(stack, 'TestInboxBucket3');
    const kvsArn = 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs';
    const originVerifySecret = 'test-secret';

    const compute = new ComputeInstance(stack, 'ComputeSimpleDomain', {
      vpc,
      mediaBucket,
      inboxBucket,
      kvsArn,
      originVerifySecret,
      domainName: 'paperless',
    });

    const userData = compute.instance.userData.render();
    expect(userData).toContain('DOMAIN_NAME=paperless');
    expect(userData).toContain(
      'PAPERLESS_CSRF_TRUSTED_ORIGINS=https://paperless,https://*.localhost,https://*.cloudfront.net,https://localhost,http://localhost'
    );
  });
});
