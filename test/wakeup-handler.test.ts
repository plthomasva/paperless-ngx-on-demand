import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock send function
const mockEc2Send = vi.fn();
const mockKvsSend = vi.fn();

vi.mock('@aws-sdk/client-ec2', () => {
  return {
    EC2Client: vi.fn().mockImplementation(() => ({
      send: mockEc2Send,
    })),
    DescribeInstancesCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'DescribeInstances' })),
    StartInstancesCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'StartInstances' })),
  };
});

vi.mock('@aws-sdk/client-cloudfront-keyvaluestore', () => {
  return {
    CloudFrontKeyValueStoreClient: vi.fn().mockImplementation(() => ({
      send: mockKvsSend,
    })),
    DescribeKeyValueStoreCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'DescribeKvs' })),
    PutKeyCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'PutKey' })),
    GetKeyCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'GetKey' })),
  };
});

describe('Wakeup Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTANCE_ID = 'i-1234567890abcdef0';
    process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs';
  });

  it('responds with 200 JSON on /__wakeup/status when instance is running', async () => {
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            {
              State: { Name: 'running' },
              PublicDnsName: 'ec2-1-2-3-4.compute-1.amazonaws.com',
            },
          ],
        },
      ],
    });
    mockKvsSend.mockResolvedValueOnce({ Value: 'running' });

    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const event = {
      rawPath: '/__wakeup/status',
      headers: {},
    };

    const response = (await handler(event)) as any;
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json');

    const parsed = JSON.parse(response.body);
    expect(parsed.state).toBe('running');
    expect(parsed.publicHostname).toBe('ec2-1-2-3-4.compute-1.amazonaws.com');
  });

  it('serves splash page on GET /documents without starting instance (defends against crawlers)', async () => {
    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const event = {
      rawPath: '/documents',
      headers: { host: 'paperless.example.com', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    };

    const response = (await handler(event)) as any;
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/html');
    expect(response.body).toContain('Waking Up Paperless-NGX');
    expect(response.body).toContain('/documents');
    expect(response.body).toContain('favicon.ico');
    expect(response.body).toContain('action=wake');

    // Instance is NOT started on initial GET /
    expect(mockEc2Send).not.toHaveBeenCalled();
  });

  it('triggers StartInstances when JavaScript client executes /__wakeup/status?action=wake', async () => {
    // 1st DescribeInstances in startInstanceIfNeeded
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
    });
    // StartInstances succeeds
    mockEc2Send.mockResolvedValueOnce({});
    // KVS describe returns ETag & put succeeds
    mockKvsSend.mockResolvedValueOnce({ ETag: 'ETAG123' });
    mockKvsSend.mockResolvedValueOnce({});

    // 2nd DescribeInstances in status poll
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [{ Instances: [{ State: { Name: 'pending' }, PublicDnsName: 'ec2-test.compute-1.amazonaws.com' }] }],
    });
    // KVS get status
    mockKvsSend.mockResolvedValueOnce({ Value: 'starting' });

    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const event = {
      rawPath: '/__wakeup/status',
      rawQueryString: 'action=wake&t=1234567890',
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    };

    const response = (await handler(event)) as any;
    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body);
    expect(parsed.state).toBe('starting');

    // Verify StartInstances was called
    expect(mockEc2Send).toHaveBeenCalled();
  });

  it('serves robots.txt with Disallow without starting instance', async () => {
    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const response = (await handler({ rawPath: '/robots.txt', headers: {} })) as any;
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/plain');
    expect(response.body).toContain('Disallow: /');
    expect(mockEc2Send).not.toHaveBeenCalled();
  });

  it('serves official Paperless favicon.ico without starting instance', async () => {
    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const response = (await handler({ rawPath: '/favicon.ico', headers: {} })) as any;
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('image/x-icon');
    expect(response.isBase64Encoded).toBe(true);
    expect(response.body.length).toBeGreaterThan(1000);
    expect(mockEc2Send).not.toHaveBeenCalled();
  });

  it('rejects bot scanner probes with 404 without starting instance', async () => {
    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const response = (await handler({ rawPath: '/.env', headers: {} })) as any;
    expect(response.statusCode).toBe(404);
    expect(mockEc2Send).not.toHaveBeenCalled();
  });

  it('rejects crawler User-Agents with 403 without starting instance', async () => {
    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const response = (await handler({
      rawPath: '/',
      headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
    })) as any;
    expect(response.statusCode).toBe(403);
    expect(mockEc2Send).not.toHaveBeenCalled();
  });

  it('starts instance on S3 ObjectCreated event from inbox bucket', async () => {
    mockEc2Send.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            {
              State: { Name: 'stopped' },
            },
          ],
        },
      ],
    });
    mockEc2Send.mockResolvedValueOnce({});
    mockKvsSend.mockResolvedValueOnce({ ETag: 'ETAG123' });
    mockKvsSend.mockResolvedValueOnce({});

    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const s3Event = {
      Records: [
        {
          s3: {
            bucket: { name: 'test-inbox-bucket' },
            object: { key: 'consume/scan_20261105.pdf' },
          },
        },
      ],
    };

    await handler(s3Event);
    expect(mockEc2Send).toHaveBeenCalledTimes(2);
  });

  it('resets KVS status to stopped when EC2 EventBridge state-change is stopped', async () => {
    mockKvsSend.mockResolvedValueOnce({ ETag: 'ETAG123' });
    mockKvsSend.mockResolvedValueOnce({});
    mockKvsSend.mockResolvedValueOnce({ ETag: 'ETAG456' });
    mockKvsSend.mockResolvedValueOnce({});

    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const eventBridgeEvent = {
      'detail-type': 'EC2 Instance State-change Notification',
      detail: {
        'instance-id': 'i-1234567890abcdef0',
        state: 'stopped',
      },
    };

    await handler(eventBridgeEvent);
    expect(mockKvsSend).toHaveBeenCalled();
  });
});

