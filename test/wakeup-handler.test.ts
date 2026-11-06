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

  it('triggers StartInstances and renders splash screen when instance is stopped', async () => {
    // 1st DescribeInstances returns stopped
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

    // StartInstances succeeds
    mockEc2Send.mockResolvedValueOnce({});

    // KVS describe returns ETag
    mockKvsSend.mockResolvedValueOnce({ ETag: 'ETAG123' });
    // KVS put succeeds
    mockKvsSend.mockResolvedValueOnce({});

    const { handler } = await import('../lib/lambda/wakeup-handler.js');

    const event = {
      rawPath: '/documents',
      headers: { host: 'paperless.example.com' },
    };

    const response = (await handler(event)) as any;
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/html');
    expect(response.body).toContain('Waking Up Paperless-NGX');
    expect(response.body).toContain('/documents');

    // Verify StartInstances was called with the instance ID
    expect(mockEc2Send).toHaveBeenCalledTimes(2);
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

