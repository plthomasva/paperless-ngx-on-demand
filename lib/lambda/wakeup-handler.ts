import { EC2Client, DescribeInstancesCommand, StartInstancesCommand } from '@aws-sdk/client-ec2';
import {
  CloudFrontKeyValueStoreClient,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
  GetKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import { renderWakeupPage } from './wakeup-page.js';
import { PAPERLESS_FAVICON_BASE64 } from './favicon-data.js';

const ec2 = new EC2Client({});
const kvs = new CloudFrontKeyValueStoreClient({});

const INSTANCE_ID = process.env.INSTANCE_ID || '';
const KVS_ARN = process.env.KVS_ARN || '';

const BOT_UA_REGEX =
  /(bot|crawler|spider|slurp|bingpreview|headless|ahrefs|semrush|petalbot|bytespider|yandex)/i;
const SCANNER_PROBE_REGEX = /\.(php|asp|aspx|jsp|cgi|env|git|yml|yaml|bak|sql|tar|gz|zip)($|\?)/i;
const SCANNER_PATH_PREFIXES = [
  '/wp-login',
  '/wp-admin',
  '/admin',
  '/xmlrpc.php',
  '/phpmyadmin',
  '/boaform',
  '/setup.cgi',
];

interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  isBase64Encoded?: boolean;
  body: string;
}

export async function getKvsStatus(kvsArn: string): Promise<string> {
  if (!kvsArn) return 'unknown';
  try {
    const res = await kvs.send(new GetKeyCommand({ KvsARN: kvsArn, Key: 'status' }));
    return res.Value || 'unknown';
  } catch (_err) {
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

export async function getInstanceState(
  instanceId: string
): Promise<{ state: string; publicHostname?: string }> {
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
  const userAgent = event?.headers?.['user-agent'] || event?.headers?.['User-Agent'] || '';

  // 3a. robots.txt - Return Disallow without waking compute
  if (requestPath === '/robots.txt') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
      body: 'User-agent: *\nDisallow: /\n',
    };
  }

  // 3b. favicon.ico - Return official Paperless icon without waking compute
  if (requestPath === '/favicon.ico') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/x-icon',
        'Cache-Control': 'public, max-age=604800',
      },
      isBase64Encoded: true,
      body: PAPERLESS_FAVICON_BASE64,
    };
  }

  // 3c. Scanner / vulnerability probe paths - Return 404 without waking compute
  if (
    SCANNER_PROBE_REGEX.test(requestPath) ||
    SCANNER_PATH_PREFIXES.some((p) => requestPath.startsWith(p))
  ) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
      body: 'Not Found\n',
    };
  }

  // Endpoint: /__wakeup/status JSON poll
  if (requestPath.startsWith('/__wakeup/status')) {
    const rawQuery = event?.rawQueryString || '';
    const shouldWake =
      rawQuery.includes('action=wake') || event?.requestContext?.http?.method === 'POST';

    // If JavaScript initiated the wake action and is not a known crawler bot, trigger wake
    if (shouldWake && !BOT_UA_REGEX.test(userAgent)) {
      await startInstanceIfNeeded(INSTANCE_ID);
    }

    const { state: ec2State, publicHostname } = await getInstanceState(INSTANCE_ID);
    const kvsStatus = await getKvsStatus(KVS_ARN);

    // The application is ONLY considered "running" when the EC2 boot-sync hook
    // has verified that Paperless is healthy on port 8000 AND updated KVS.
    let effectiveState: string;
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

  // If request is from a known crawler / bot, return Disallow without waking
  if (BOT_UA_REGEX.test(userAgent)) {
    return {
      statusCode: 403,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
      body: 'Access denied: Crawler indexing disallowed.\n',
    };
  }

  // Render the splash page. The browser's client-side JavaScript will execute
  // and trigger /__wakeup/status?action=wake, avoiding crawler / scanner auto-wakeups.
  const html = renderWakeupPage(requestPath);
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
    body: html,
  };
}
