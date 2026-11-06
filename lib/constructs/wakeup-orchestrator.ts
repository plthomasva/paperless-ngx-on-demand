import * as path from 'path';
import { fileURLToPath } from 'url';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime, FunctionUrl, FunctionUrlAuthType, HttpMethod } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IBucket, EventType } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { IInstance } from 'aws-cdk-lib/aws-ec2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface WakeupOrchestratorProps {
  readonly instance: IInstance;
  readonly kvsArn: string;
  readonly inboxBucket: IBucket;
}

export class WakeupOrchestrator extends Construct {
  public readonly wakeupFunction: NodejsFunction;
  public readonly functionUrl: FunctionUrl;

  constructor(scope: Construct, id: string, props: WakeupOrchestratorProps) {
    super(scope, id);

    // 1. Wake-Up & Lifecycle Lambda Function
    this.wakeupFunction = new NodejsFunction(this, 'WakeupHandler', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/wakeup-handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        INSTANCE_ID: props.instance.instanceId,
        KVS_ARN: props.kvsArn,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        format: OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // 2. Grant EC2 & CloudFront KeyValueStore permissions
    this.wakeupFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['ec2:DescribeInstances'],
        resources: ['*'],
      })
    );

    this.wakeupFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['ec2:StartInstances'],
        resources: [`arn:aws:ec2:*:*:instance/${props.instance.instanceId}`],
      })
    );

    this.wakeupFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'cloudfront-keyvaluestore:DescribeKeyValueStore',
          'cloudfront-keyvaluestore:PutKey',
          'cloudfront-keyvaluestore:GetKey',
        ],
        resources: [props.kvsArn],
      })
    );

    // 3. Lambda Function URL for CloudFront default origin and status polls
    this.functionUrl = this.wakeupFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    // 4. S3 ObjectCreated trigger on Inbox Bucket under consume/ prefix
    props.inboxBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(this.wakeupFunction),
      { prefix: 'consume/' }
    );

    // 5. EventBridge Rule on EC2 Instance State-change Notification
    // Resets KVS status='stopped' and originDomain='' on instance shutdown
    const stateChangeRule = new Rule(this, 'Ec2StateChangeRule', {
      description: 'Notifies Wakeup Lambda when Paperless EC2 instance stops',
      eventPattern: {
        source: ['aws.ec2'],
        detailType: ['EC2 Instance State-change Notification'],
        detail: {
          'instance-id': [props.instance.instanceId],
          state: ['stopping', 'stopped', 'shutting-down'],
        },
      },
    });

    stateChangeRule.addTarget(new LambdaFunction(this.wakeupFunction));
  }
}
