import { Construct } from 'constructs';
import {
  IVpc,
  SecurityGroup,
  Peer,
  Port,
  Instance,
  InstanceType,
  InstanceClass,
  InstanceSize,
  MachineImage,
  AmazonLinuxCpuType,
  BlockDeviceVolume,
  EbsDeviceVolumeType,
  UserData,
  SubnetType,
} from 'aws-cdk-lib/aws-ec2';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';

export interface ComputeInstanceProps {
  readonly vpc: IVpc;
  readonly mediaBucket: IBucket;
  readonly inboxBucket: IBucket;
  readonly mediaSubpath?: string;
  readonly kvsArn: string;
  readonly originVerifySecret: string;
  readonly cloudfrontPrefixListId?: string;
  readonly adminUser?: string;
  readonly adminPassword?: string;
  readonly adminEmail?: string;
  readonly domainName?: string;
}

export class ComputeInstance extends Construct {
  public readonly instance: Instance;
  public readonly securityGroup: SecurityGroup;
  public readonly role: Role;

  constructor(scope: Construct, id: string, props: ComputeInstanceProps) {
    super(scope, id);

    // 1. IAM Role with SSM Session Manager Core (No open SSH port 22 needed!)
    this.role = new Role(this, 'PaperlessEc2Role', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM role for Paperless-NGX EC2 instance with S3, KVS, and SSM permissions',
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });

    // Grant access to existing S3 Media bucket (for s3fs)
    props.mediaBucket.grantReadWrite(this.role);

    // Grant access to S3 Inbox & Backups bucket
    props.inboxBucket.grantReadWrite(this.role);

    // Grant access to update CloudFront KeyValueStore routing state
    this.role.addToPolicy(
      new PolicyStatement({
        actions: [
          'cloudfront-keyvaluestore:DescribeKeyValueStore',
          'cloudfront-keyvaluestore:PutKey',
          'cloudfront-keyvaluestore:GetKey',
        ],
        resources: [props.kvsArn],
      })
    );

    // 2. Security Group: Inbound port 8000 from CloudFront Managed Prefix List
    this.securityGroup = new SecurityGroup(this, 'PaperlessSecurityGroup', {
      vpc: props.vpc,
      description: 'Allow inbound traffic to Paperless activity proxy from CloudFront only',
      allowAllOutbound: true,
    });

    // CloudFront origin-facing managed prefix list (defaults to us-east-1 'pl-3b927c52')
    const prefixListId = props.cloudfrontPrefixListId || 'pl-3b927c52';
    this.securityGroup.addIngressRule(
      Peer.prefixList(prefixListId),
      Port.tcp(8000),
      'Allow HTTP on port 8000 from CloudFront edge origins'
    );

    // 3. Cloud-Init UserData script
    const userData = UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -xeuo pipefail',
      '',
      'echo "=== Initializing Paperless-NGX On-Demand Host ==="',
      'dnf update -y',
      'dnf install -y docker mount-s3 aws-cli sqlite tar gzip',
      '',
      '# Enable user_allow_other in fuse.conf for mount-s3',
      'echo "user_allow_other" >> /etc/fuse.conf',
      '',
      '# Enable and start Docker',
      'systemctl enable docker',
      'systemctl start docker',
      '',
      '# Install docker compose plugin',
      'DOCKER_CONFIG=${DOCKER_CONFIG:-/usr/local/lib/docker}',
      'mkdir -p $DOCKER_CONFIG/cli-plugins',
      'curl -SL https://github.com/docker/compose/releases/download/v2.29.2/docker-compose-linux-aarch64 -o $DOCKER_CONFIG/cli-plugins/docker-compose',
      'chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose',
      'ln -sf $DOCKER_CONFIG/cli-plugins/docker-compose /usr/local/bin/docker-compose || true',
      '',
      '# Create directories',
      'mkdir -p /opt/paperless/runtime /mnt/data /mnt/paperless-media /mnt/consume /mnt/export /tmp/paperless /var/cache/s3fs',
      '',
      '# Write environment file',
      "cat << 'EOF' > /opt/paperless/runtime/.env",
      `MEDIA_BUCKET=${props.mediaBucket.bucketName}`,
      `MEDIA_SUBPATH=${props.mediaSubpath || 'media'}`,
      `INBOX_BUCKET=${props.inboxBucket.bucketName}`,
      `KVS_NAME=${props.kvsArn}`,
      `ORIGIN_VERIFY_SECRET=${props.originVerifySecret}`,
      `DOMAIN_NAME=${props.domainName || 'localhost'}`,
      `PAPERLESS_URL=https://${props.domainName || 'localhost'}`,
      `PAPERLESS_CSRF_TRUSTED_ORIGINS=https://${props.domainName || 'localhost'},https://*.cloudfront.net,https://localhost,http://localhost`,
      `PAPERLESS_ADMIN_USER=${props.adminUser || 'admin'}`,
      `PAPERLESS_ADMIN_PASSWORD=${props.adminPassword || 'admin'}`,
      `PAPERLESS_ADMIN_EMAIL=${props.adminEmail || 'admin@example.com'}`,
      'AWS_REGION=us-east-1',
      'EOF',
      '',
      '# Sync runtime scripts from S3 bucket',
      `aws s3 sync s3://${props.mediaBucket.bucketName}/runtime/ /opt/paperless/runtime/ --region us-east-1 || true`,
      'chmod +x /opt/paperless/runtime/*.sh || true',
      '',
      '# Create systemd boot sync service',
      "cat << 'EOF' > /etc/systemd/system/paperless-boot.service",
      '[Unit]',
      'Description=Paperless-NGX Boot Sync and Initialization',
      'After=network-online.target docker.service',
      'Wants=network-online.target docker.service',
      '',
      '[Service]',
      'Type=oneshot',
      'EnvironmentFile=/opt/paperless/runtime/.env',
      'ExecStart=/opt/paperless/runtime/boot-sync.sh',
      'RemainAfterExit=yes',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      '',
      '# Create systemd watchdog service',
      "cat << 'EOF' > /etc/systemd/system/paperless-watchdog.service",
      '[Unit]',
      'Description=Paperless-NGX Session & Indexing Drain Watchdog',
      'After=paperless-boot.service',
      'Wants=paperless-boot.service',
      '',
      '[Service]',
      'Type=simple',
      'EnvironmentFile=/opt/paperless/runtime/.env',
      'ExecStart=/opt/paperless/runtime/watchdog.sh',
      'Restart=always',
      'RestartSec=10',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      '',
      'systemctl daemon-reload',
      'systemctl enable paperless-boot.service paperless-watchdog.service'
    );

    // 4. EC2 Instance: t4g.medium (Graviton ARM64) with 10 GB gp3 root disk
    this.instance = new Instance(this, 'PaperlessInstance', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
      machineImage: MachineImage.latestAmazonLinux2023({
        cpuType: AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup: this.securityGroup,
      role: this.role,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: BlockDeviceVolume.ebs(10, {
            volumeType: EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: false, // Preserve EBS volume on accidental termination
          }),
        },
      ],
    });
  }
}
