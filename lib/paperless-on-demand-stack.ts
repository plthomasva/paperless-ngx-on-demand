import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc, SubnetType, GatewayVpcEndpointAwsService } from 'aws-cdk-lib/aws-ec2';
import { Bucket, BlockPublicAccess, BucketEncryption, IBucket } from 'aws-cdk-lib/aws-s3';
import { KeyValueStore } from 'aws-cdk-lib/aws-cloudfront';
import { ComputeInstance } from './constructs/compute-instance.js';
import { EdgeRouter } from './constructs/edge-router.js';
import { WakeupOrchestrator } from './constructs/wakeup-orchestrator.js';
import * as crypto from 'crypto';

export interface PaperlessOnDemandStackProps extends StackProps {
  /**
   * Name of your existing S3 bucket containing Paperless storage.
   * If omitted, a conflict-free account-and-region namespaced bucket
   * (paperless-storage-${account}-${region}) is created automatically.
   */
  readonly existingBucketName?: string;

  /**
   * Alias for existingBucketName (for backwards compatibility).
   */
  readonly existingMediaBucketName?: string;

  /**
   * S3 prefix inside the storage bucket where media/documents reside.
   * Defaults to 'media'.
   */
  readonly mediaSubpath?: string;

  /**
   * Optional custom domain or hostname for Paperless-NGX (e.g. pod.painless-computing.com).
   */
  readonly domainName?: string;

  /**
   * Optional existing ACM Certificate ARN in us-east-1 for the custom domain.
   * If omitted but domainName is set, CDK will provision a new ACM certificate with DNS validation.
   */
  readonly certificateArn?: string;

  /**
   * Admin username for initial Paperless-NGX setup.
   * @default 'admin'
   */
  readonly adminUser?: string;

  /**
   * Admin email for initial Paperless-NGX setup.
   * @default 'admin@example.com'
   */
  readonly adminEmail?: string;

  /**
   * CloudFront managed prefix list ID for the deployment region.
   * Defaults to us-east-1 'pl-3b927c52'.
   */
  readonly cloudfrontPrefixListId?: string;
}

export class PaperlessOnDemandStack extends Stack {
  public readonly vpc: Vpc;
  public readonly mediaBucket: IBucket;
  public readonly inboxBucket: IBucket;
  public readonly compute: ComputeInstance;
  public readonly orchestrator: WakeupOrchestrator;
  public readonly edgeRouter: EdgeRouter;

  constructor(scope: Construct, id: string, props: PaperlessOnDemandStackProps = {}) {
    super(scope, id, props);

    // 1. VPC: Zero-cost architecture (1 Public Subnet, ZERO NAT Gateways)
    this.vpc = new Vpc(this, 'PaperlessVpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: SubnetType.PUBLIC,
        },
      ],
    });

    // 2. Add free S3 Gateway VPC Endpoint for multi-gigabit $0 data transfer
    this.vpc.addGatewayEndpoint('S3GatewayEndpoint', {
      service: GatewayVpcEndpointAwsService.S3,
    });

    // 3. S3 Storage Configuration:
    // If an existing bucket name is provided, use it.
    // If starting fresh, generate a conflict-free account-and-region namespaced bucket name.
    const existingName = props.existingBucketName || props.existingMediaBucketName;
    if (existingName) {
      const existing = Bucket.fromBucketName(this, 'ExistingStorageBucket', existingName);
      this.mediaBucket = existing;
      this.inboxBucket = existing;
    } else {
      const defaultBucketName = `paperless-storage-${this.account}-${this.region}`;
      const defaultBucket = new Bucket(this, 'StorageBucket', {
        bucketName: defaultBucketName,
        encryption: BucketEncryption.S3_MANAGED,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        versioned: true,
        lifecycleRules: [
          {
            id: 'ExpireOldBackups',
            prefix: 'backups/paperless-data-2',
            expiration: Duration.days(60),
          },
        ],
        removalPolicy: RemovalPolicy.RETAIN,
      });
      this.mediaBucket = defaultBucket;
      this.inboxBucket = defaultBucket;
    }

    // Generate a secure secret token for CloudFront -> Origin verification
    const originVerifySecret = crypto.randomBytes(32).toString('hex');

    // 4. CloudFront KeyValueStore for dynamic edge routing
    const routingKvs = new KeyValueStore(this, 'RoutingKvs', {
      comment: 'Paperless-NGX dynamic edge routing state',
    });

    // 5. Compute Instance (EC2 t4g.medium Graviton in public subnet with CloudFront-only SG)
    this.compute = new ComputeInstance(this, 'Compute', {
      vpc: this.vpc,
      mediaBucket: this.mediaBucket,
      inboxBucket: this.inboxBucket,
      mediaSubpath: props.mediaSubpath,
      kvsArn: routingKvs.keyValueStoreArn,
      originVerifySecret,
      cloudfrontPrefixListId: props.cloudfrontPrefixListId,
      adminUser: props.adminUser,
      adminEmail: props.adminEmail,
      domainName: props.domainName,
    });

    // 6. Wake-Up & Lifecycle Orchestrator Lambda
    this.orchestrator = new WakeupOrchestrator(this, 'Orchestrator', {
      instance: this.compute.instance,
      kvsArn: routingKvs.keyValueStoreArn,
      inboxBucket: this.inboxBucket,
    });

    // 7. CloudFront Edge Router Distribution
    this.edgeRouter = new EdgeRouter(this, 'EdgeRouter', {
      wakeupFunctionUrl: this.orchestrator.functionUrl,
      originVerifySecret,
      keyValueStore: routingKvs,
      domainName: props.domainName,
      certificateArn: props.certificateArn,
    });

    // Stack Outputs
    const publicUrl = props.domainName
      ? `https://${props.domainName}`
      : `https://${this.edgeRouter.distribution.distributionDomainName}`;

    new CfnOutput(this, 'PaperlessUrl', {
      value: publicUrl,
      description: 'Public URL for Paperless-NGX (Point your browser here)',
    });

    new CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${this.edgeRouter.distribution.distributionDomainName}`,
      description: 'CloudFront distribution default domain',
    });

    new CfnOutput(this, 'S3StorageBucket', {
      value: this.inboxBucket.bucketName,
      description: 'Unified S3 storage bucket for media, drop ingestion (/consume), and backups',
    });

    new CfnOutput(this, 'InstanceId', {
      value: this.compute.instance.instanceId,
      description: 'EC2 Instance ID for Paperless-NGX',
    });

    new CfnOutput(this, 'KvsArn', {
      value: routingKvs.keyValueStoreArn,
      description: 'CloudFront KeyValueStore ARN for edge state',
    });
  }
}
