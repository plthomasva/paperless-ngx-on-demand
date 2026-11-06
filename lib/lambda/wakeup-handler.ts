import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
} from '@aws-sdk/client-ec2';
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
  GetKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import { renderWakeupPage } from './wakeup-page.js';

const ec2 = new EC2Client({});
const kvs = new CloudFrontKeyValueStoreClient({});

const INSTANCE_ID = process.env.INSTANCE_ID || '';
const KVS_ARN = process.env.KVS_ARN || '';

interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export async function getKvsStatus(kvsArn: string): Promise<string> {
  if (!kvsArn) return 'unknown';
  try {
    const res = await kvs.send(new GetKeyCommand({ KvsARN: kvsArn, Key: 'status' }));
    return res.Value || 'unknown';
  } catch (err: any) {
    return 'stopped';
  }
}

export async function updateKvsKey(kvsArn: string, key: string, value: string): Promise<void> {
  if (!kvsArn) return;
  try {
    const desc = await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));
    const etag = desc.ETag;
    if (etag) {
      await kvs.send(
        new PutKeyCommand({
          KvsARN: kvsArn,
          Key: key,
          Value: value,
          IfMatch: etag,
        })
      );
    }
  } catch (err) {
    console.error(`Failed to update KVS key ${key} to ${value}:`, err);
  }
}

export async function getInstanceState(instanceId: string): Promise<{ state: string; publicHostname?: string }> {
  if (!instanceId) return { state: 'unknown' };
  try {
    const res = await ec2.send(
      new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      })
    );
    const inst = res.Reservations?.[0]?.Instances?.[0];
    const state = inst?.State?.Name || 'unknown';
    const publicHostname = inst?.PublicDnsName || inst?.PublicIpAddress || undefined;
    return { state, publicHostname };
  } catch (err) {
    console.error(`Failed to describe instance ${instanceId}:`, err);
    return { state: 'unknown' };
  }
}

export async function startInstanceIfNeeded(instanceId: string): Promise<string> {
  const { state } = await getInstanceState(instanceId);
  if (state === 'stopped') {
    console.log(`Starting stopped instance ${instanceId}...`);
    await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
    await updateKvsKey(KVS_ARN, 'status', 'starting');
    return 'starting';
  }
  return state;
}

export async function handler(event: any): Promise<LambdaResponse | void> {
  console.log('Wake-Up Handler Invoked:', JSON.stringify(event));

  // 1. Check if event is an EventBridge EC2 Instance State-change Notification
  if (event?.['detail-type'] === 'EC2 Instance State-change Notification') {
    const state = event?.detail?.state;
    console.log(`Received EventBridge EC2 state transition: ${state}`);
    if (state === 'stopped' || state === 'stopping' || state === 'shutting-down') {
      console.log('Instance stopped/stopping. Resetting KVS status to stopped.');
      await updateKvsKey(KVS_ARN, 'status', 'stopped');
      await updateKvsKey(KVS_ARN, 'originDomain', '');
    }
    return;
  }

  // 2. Check if event is an S3 Event Notification (ObjectCreated)
  if (event?.Records?.[0]?.s3) {
    const bucket = event.Records[0].s3.bucket?.name;
    const key = event.Records[0].s3.object?.key;
    console.log(`S3 ObjectCreated event received: s3://${bucket}/${key}`);
    await startInstanceIfNeeded(INSTANCE_ID);
    return;
  }

  // 3. HTTP Request via Function URL or API Gateway
  const requestPath = event?.rawPath || event?.path || '/';

  // Endpoint: /__wakeup/status JSON poll
  if (requestPath.startsWith('/__wakeup/status')) {
    const { state: ec2State, publicHostname } = await getInstanceState(INSTANCE_ID);
    const kvsStatus = await getKvsStatus(KVS_ARN);

    // The application is ONLY considered "running" when the EC2 boot-sync hook
    // has verified that Paperless is healthy on port 8000 AND updated KVS.
    let effectiveState = 'stopped';
    if (kvsStatus === 'running') {
      effectiveState = 'running';
    } else if (ec2State === 'running') {
      effectiveState = 'booting';
    } else if (ec2State === 'pending') {
      effectiveState = 'starting';
    } else {
      effectiveState = ec2State;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
      body: JSON.stringify({
        state: effectiveState,
        ec2State,
        kvsStatus,
        publicHostname: publicHostname || null,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  // Any other HTTP path: Wake up the instance if stopped and show the splash screen
  await startInstanceIfNeeded(INSTANCE_ID);

  const html = renderWakeupPage(requestPath);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
    body: html,
  };
}

