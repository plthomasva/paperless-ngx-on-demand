import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mocks and environment variables are accessible in hoisted vi.mock calls and module initialization
const { mockEc2Send, mockKvsSend } = vi.hoisted(() => {
  process.env.INSTANCE_ID = 'i-1234567890abcdef0';
  process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs';
  return {
    mockEc2Send: vi.fn(),
    mockKvsSend: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-ec2', () => {
  return {
    EC2Client: vi.fn().mockImplementation(() => ({
      send: mockEc2Send,
    })),
    DescribeInstancesCommand: vi
      .fn()
      .mockImplementation((input) => ({ input, _type: 'DescribeInstances' })),
    StartInstancesCommand: vi
      .fn()
      .mockImplementation((input) => ({ input, _type: 'StartInstances' })),
  };
});

vi.mock('@aws-sdk/client-cloudfront-keyvaluestore', () => {
  return {
    CloudFrontKeyValueStoreClient: vi.fn().mockImplementation(() => ({
      send: mockKvsSend,
    })),
    DescribeKeyValueStoreCommand: vi
      .fn()
      .mockImplementation((input) => ({ input, _type: 'DescribeKvs' })),
    PutKeyCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'PutKey' })),
    GetKeyCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'GetKey' })),
  };
});

import {
  getKvsStatus,
  updateKvsKey,
  getInstanceState,
  startInstanceIfNeeded,
  handler,
} from '../lib/lambda/wakeup-handler.js';

describe('Wakeup Lambda Handler Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTANCE_ID = 'i-1234567890abcdef0';
    process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs';
  });

  describe('getKvsStatus', () => {
    it('returns unknown if kvsArn is empty', async () => {
      const res = await getKvsStatus('');
      expect(res).toBe('unknown');
      expect(mockKvsSend).not.toHaveBeenCalled();
    });

    it('returns value from KVS if key exists', async () => {
      mockKvsSend.mockResolvedValueOnce({ Value: 'running' });
      const res = await getKvsStatus('arn:aws:kvs:test');
      expect(res).toBe('running');
      expect(mockKvsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'GetKey',
          input: { KvsARN: 'arn:aws:kvs:test', Key: 'status' },
        })
      );
    });

    it('returns unknown if res.Value is empty', async () => {
      mockKvsSend.mockResolvedValueOnce({ Value: '' });
      const res = await getKvsStatus('arn:aws:kvs:test');
      expect(res).toBe('unknown');
    });

    it('catches error and returns stopped if KVS lookup fails', async () => {
      mockKvsSend.mockRejectedValueOnce(new Error('KVS error'));
      const res = await getKvsStatus('arn:aws:kvs:test');
      expect(res).toBe('stopped');
    });
  });

  describe('updateKvsKey', () => {
    it('returns immediately without sending if kvsArn is empty', async () => {
      await updateKvsKey('', 'status', 'running');
      expect(mockKvsSend).not.toHaveBeenCalled();
    });

    it('updates KVS key when describe returns an ETag', async () => {
      mockKvsSend.mockResolvedValueOnce({ ETag: 'ETAG_VAL' });
      mockKvsSend.mockResolvedValueOnce({});
      await updateKvsKey('arn:aws:kvs:test', 'status', 'running');
      expect(mockKvsSend).toHaveBeenCalledTimes(2);
      expect(mockKvsSend).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          _type: 'DescribeKvs',
          input: { KvsARN: 'arn:aws:kvs:test' },
        })
      );
      expect(mockKvsSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          _type: 'PutKey',
          input: {
            KvsARN: 'arn:aws:kvs:test',
            Key: 'status',
            Value: 'running',
            IfMatch: 'ETAG_VAL',
          },
        })
      );
    });

    it('does not put key if describe returns no ETag', async () => {
      mockKvsSend.mockResolvedValueOnce({ ETag: undefined });
      await updateKvsKey('arn:aws:kvs:test', 'status', 'running');
      expect(mockKvsSend).toHaveBeenCalledTimes(1);
    });

    it('catches error if describe or put fails', async () => {
      mockKvsSend.mockRejectedValueOnce(new Error('Describe failed'));
      await expect(updateKvsKey('arn:aws:kvs:test', 'status', 'running')).resolves.not.toThrow();
    });
  });

  describe('getInstanceState', () => {
    it('returns unknown if instanceId is empty', async () => {
      const res = await getInstanceState('');
      expect(res).toEqual({ state: 'unknown' });
      expect(mockEc2Send).not.toHaveBeenCalled();
    });

    it('handles empty Reservations array', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [],
      });
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({ state: 'unknown', publicHostname: undefined });
    });

    it('handles Reservation with empty Instances array', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [] }],
      });
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({ state: 'unknown', publicHostname: undefined });
    });

    it('handles Instance with undefined State', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: undefined }] }],
      });
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({ state: 'unknown', publicHostname: undefined });
    });

    it('handles Instance with empty State object', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: {} }] }],
      });
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({ state: 'unknown', publicHostname: undefined });
    });

    it('returns state and PublicDnsName when available', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [
          {
            Instances: [
              {
                State: { Name: 'running' },
                PublicDnsName: 'ec2-test.compute.amazonaws.com',
              },
            ],
          },
        ],
      });
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({
        state: 'running',
        publicHostname: 'ec2-test.compute.amazonaws.com',
      });
      expect(mockEc2Send).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'DescribeInstances',
          input: { InstanceIds: ['i-12345'] },
        })
      );
    });

    it('falls back to PublicIpAddress if PublicDnsName is empty', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [
          {
            Instances: [
              {
                State: { Name: 'running' },
                PublicDnsName: '',
                PublicIpAddress: '54.210.1.2',
              },
            ],
          },
        ],
      });
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({
        state: 'running',
        publicHostname: '54.210.1.2',
      });
    });

    it('returns undefined publicHostname if neither dns nor ip is present', async () => {
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
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({
        state: 'stopped',
        publicHostname: undefined,
      });
    });

    it('returns unknown if State.Name is missing', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{}] }],
      });
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({
        state: 'unknown',
        publicHostname: undefined,
      });
    });

    it('catches error and returns unknown if describeInstances throws', async () => {
      mockEc2Send.mockRejectedValueOnce(new Error('EC2 throttled'));
      const res = await getInstanceState('i-12345');
      expect(res).toEqual({ state: 'unknown' });
    });
  });

  describe('startInstanceIfNeeded', () => {
    it('starts stopped instance and updates KVS to starting', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
      });
      mockEc2Send.mockResolvedValueOnce({});
      mockKvsSend.mockResolvedValueOnce({ ETag: 'ET1' });
      mockKvsSend.mockResolvedValueOnce({});

      const state = await startInstanceIfNeeded('i-12345');
      expect(state).toBe('starting');
      expect(mockEc2Send).toHaveBeenCalledTimes(2);
      expect(mockEc2Send).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          _type: 'StartInstances',
          input: { InstanceIds: ['i-12345'] },
        })
      );
      expect(mockKvsSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          _type: 'PutKey',
          input: expect.objectContaining({
            Key: 'status',
            Value: 'starting',
          }),
        })
      );
    });

    it('does not start instance if already running or pending', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
      });

      const state = await startInstanceIfNeeded('i-12345');
      expect(state).toBe('running');
      expect(mockEc2Send).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Wakeup Lambda Handler Event Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTANCE_ID = 'i-1234567890abcdef0';
    process.env.KVS_ARN = 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs';
  });

  describe('EventBridge EC2 State-change Notifications', () => {
    it('resets KVS on stopped state', async () => {
      mockKvsSend.mockResolvedValue({ ETag: 'ETAG' });
      await handler({
        'detail-type': 'EC2 Instance State-change Notification',
        detail: { state: 'stopped' },
      });
      expect(mockKvsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'PutKey',
          input: expect.objectContaining({
            KvsARN: 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs',
            Key: 'status',
            Value: 'stopped',
          }),
        })
      );
      expect(mockKvsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'PutKey',
          input: expect.objectContaining({
            KvsARN: 'arn:aws:cloudfront::123456789012:key-value-store/test-kvs',
            Key: 'originDomain',
            Value: '',
          }),
        })
      );
    });

    it('resets KVS on stopping state', async () => {
      mockKvsSend.mockResolvedValue({ ETag: 'ETAG' });
      await handler({
        'detail-type': 'EC2 Instance State-change Notification',
        detail: { state: 'stopping' },
      });
      expect(mockKvsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'PutKey',
          input: expect.objectContaining({
            Key: 'status',
            Value: 'stopped',
          }),
        })
      );
    });

    it('resets KVS on shutting-down state', async () => {
      mockKvsSend.mockResolvedValue({ ETag: 'ETAG' });
      await handler({
        'detail-type': 'EC2 Instance State-change Notification',
        detail: { state: 'shutting-down' },
      });
      expect(mockKvsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'PutKey',
          input: expect.objectContaining({
            Key: 'status',
            Value: 'stopped',
          }),
        })
      );
    });

    it('does nothing on other states like running', async () => {
      await handler({
        'detail-type': 'EC2 Instance State-change Notification',
        detail: { state: 'running' },
      });
      expect(mockKvsSend).not.toHaveBeenCalled();
    });
  });

  describe('S3 Event Notifications', () => {
    it('starts instance on ObjectCreated event', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
      });
      mockEc2Send.mockResolvedValueOnce({});
      mockKvsSend.mockResolvedValue({ ETag: 'ETAG' });

      await handler({
        Records: [
          {
            s3: {
              bucket: { name: 'my-bucket' },
              object: { key: 'consume/scan.pdf' },
            },
          },
        ],
      });
      expect(mockEc2Send).toHaveBeenCalledTimes(2);
    });

    it('handles S3 notification with missing bucket or object keys gracefully', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
      });
      mockEc2Send.mockResolvedValueOnce({});
      mockKvsSend.mockResolvedValue({ ETag: 'ETAG' });

      await handler({
        Records: [
          {
            s3: {},
          },
        ],
      });
      expect(mockEc2Send).toHaveBeenCalledTimes(2);
    });

    it('does nothing if Records is empty or has no s3 property', async () => {
      await handler({ Records: [] });
      await handler({ Records: [{}] });
      expect(mockEc2Send).not.toHaveBeenCalled();
    });
  });

  describe('Static & Probe Paths', () => {
    it('serves robots.txt with Disallow and strict headers', async () => {
      const res = (await handler({ rawPath: '/robots.txt', headers: {} })) as any;
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
      expect(res.headers['Cache-Control']).toBe('public, max-age=86400');
      expect(res.body).toBe('User-agent: *\nDisallow: /\n');
      expect(mockEc2Send).not.toHaveBeenCalled();
    });

    it('serves favicon.ico with base64 encoded icon and cache headers', async () => {
      const res = (await handler({ rawPath: '/favicon.ico', headers: {} })) as any;
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('image/x-icon');
      expect(res.headers['Cache-Control']).toBe('public, max-age=604800');
      expect(res.isBase64Encoded).toBe(true);
      expect(res.body.length).toBeGreaterThan(500);
      expect(mockEc2Send).not.toHaveBeenCalled();
    });

    it.each([
      '/.env',
      '/config.git',
      '/backup.sql',
      '/app.bak',
      '/shell.php',
      '/index.asp',
      '/default.aspx',
      '/login.jsp',
      '/admin.cgi',
      '/archive.tar',
      '/archive.gz',
      '/data.zip',
      '/config.yml',
      '/config.yaml',
      '/wp-login.php',
      '/wp-admin/index.php',
      '/admin/config',
      '/xmlrpc.php',
      '/phpmyadmin/index.php',
      '/boaform/admin',
      '/setup.cgi',
    ])('rejects scanner probe path %s with 404', async (path) => {
      const res = (await handler({ rawPath: path, headers: {} })) as any;
      expect(res.statusCode).toBe(404);
      expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
      expect(res.headers['Cache-Control']).toBe('public, max-age=86400');
      expect(res.body).toBe('Not Found\n');
      expect(mockEc2Send).not.toHaveBeenCalled();
    });
  });

  describe('/__wakeup/status endpoint', () => {
    it('responds with effectiveState running when kvs status is running', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [
          { Instances: [{ State: { Name: 'running' }, PublicDnsName: 'ec2.aws.com' }] },
        ],
      });
      mockKvsSend.mockResolvedValueOnce({ Value: 'running' });

      const res = (await handler({ rawPath: '/__wakeup/status', headers: {} })) as any;
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.state).toBe('running');
      expect(body.kvsStatus).toBe('running');
      expect(body.ec2State).toBe('running');
      expect(body.publicHostname).toBe('ec2.aws.com');
    });

    it('responds with effectiveState booting when ec2 is running but kvs is not running', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
      });
      mockKvsSend.mockResolvedValueOnce({ Value: 'starting' });

      const res = (await handler({ rawPath: '/__wakeup/status', headers: {} })) as any;
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(res.headers['Cache-Control']).toBe('no-store, no-cache, must-revalidate');

      const body = JSON.parse(res.body);
      expect(body.state).toBe('booting');
      expect(body.ec2State).toBe('running');
      expect(body.kvsStatus).toBe('starting');
      expect(body.publicHostname).toBeNull();
      expect(body.timestamp).toBeDefined();
    });

    it('responds with effectiveState starting when ec2 is pending', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [
          {
            Instances: [
              {
                State: { Name: 'pending' },
                PublicIpAddress: '54.1.2.3',
              },
            ],
          },
        ],
      });
      mockKvsSend.mockResolvedValueOnce({ Value: 'stopped' });

      const res = (await handler({ rawPath: '/__wakeup/status', headers: {} })) as any;
      const body = JSON.parse(res.body);
      expect(body.state).toBe('starting');
      expect(body.ec2State).toBe('pending');
      expect(body.publicHostname).toBe('54.1.2.3');
    });

    it('responds with effectiveState stopped when ec2 is stopped and kvs is stopped', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
      });
      mockKvsSend.mockResolvedValueOnce({ Value: 'stopped' });

      const res = (await handler({ rawPath: '/__wakeup/status', headers: {} })) as any;
      const body = JSON.parse(res.body);
      expect(body.state).toBe('stopped');
      expect(body.ec2State).toBe('stopped');
    });

    it('triggers startInstance when method is POST', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
      });
      mockEc2Send.mockResolvedValueOnce({});
      mockKvsSend.mockResolvedValue({ ETag: 'ETAG' });
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'pending' } }] }],
      });

      const res = (await handler({
        rawPath: '/__wakeup/status',
        requestContext: { http: { method: 'POST' } },
        headers: {},
      })) as any;
      expect(res.statusCode).toBe(200);
      expect(mockEc2Send).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'StartInstances',
          input: { InstanceIds: ['i-1234567890abcdef0'] },
        })
      );
    });

    it('triggers startInstance when query contains action=wake', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
      });
      mockEc2Send.mockResolvedValueOnce({});
      mockKvsSend.mockResolvedValue({ ETag: 'ETAG' });
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'pending' } }] }],
      });

      const res = (await handler({
        rawPath: '/__wakeup/status',
        rawQueryString: 'action=wake',
        headers: {},
      })) as any;
      expect(res.statusCode).toBe(200);
      expect(mockEc2Send).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'StartInstances',
          input: { InstanceIds: ['i-1234567890abcdef0'] },
        })
      );
    });

    it('does NOT trigger startInstance if action=wake is sent by a known crawler bot', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'stopped' } }] }],
      });
      mockKvsSend.mockResolvedValueOnce({ Value: 'stopped' });

      const res = (await handler({
        rawPath: '/__wakeup/status',
        rawQueryString: 'action=wake',
        headers: { 'user-agent': 'compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/' },
      })) as any;
      expect(res.statusCode).toBe(200);
      // StartInstancesCommand should NOT have been invoked
      expect(mockEc2Send).toHaveBeenCalledTimes(1); // only DescribeInstances
    });
  });

  describe('User-Agent and Splash Page Rendering', () => {
    it('returns 403 when crawler visits root or document pages', async () => {
      const res = (await handler({
        rawPath: '/documents',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
        },
      })) as any;
      expect(res.statusCode).toBe(403);
      expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
      expect(res.headers['Cache-Control']).toBe('public, max-age=86400');
      expect(res.body).toBe('Access denied: Crawler indexing disallowed.\n');
    });

    it('renders splash screen with security headers when user visits unknown path', async () => {
      const res = (await handler({
        path: '/documents/view/123',
        headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' },
      })) as any;
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(res.headers['Cache-Control']).toBe('no-store, no-cache, must-revalidate');
      expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(res.headers['X-Frame-Options']).toBe('DENY');
      expect(res.headers['Referrer-Policy']).toBe('no-referrer');
      expect(res.body).toContain('<!DOCTYPE html>');
      expect(res.body).toContain('/documents/view/123');
    });

    it('uses fallback path slash if neither rawPath nor path is provided', async () => {
      const res = (await handler({ headers: {} })) as any;
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('handles undefined event safely and returns splash page', async () => {
      const res = (await handler(undefined as any)) as any;
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('handles event without headers property safely', async () => {
      const res = (await handler({ rawPath: '/documents' })) as any;
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('reads User-Agent from capitalized header property', async () => {
      const res = (await handler({
        rawPath: '/documents',
        headers: { 'User-Agent': 'CustomBrowser/1.0' },
      })) as any;
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<!DOCTYPE html>');
    });

    it('handles /__wakeup/status with subpaths and missing http context using startsWith', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
      });
      mockKvsSend.mockResolvedValueOnce({ Value: 'running' });

      const res = (await handler({
        rawPath: '/__wakeup/status/subpath',
        rawQueryString: 'foo=bar',
        requestContext: { http: undefined },
      })) as any;
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.state).toBe('running');
    });

    it('handles /__wakeup/status with empty requestContext object safely', async () => {
      mockEc2Send.mockResolvedValueOnce({
        Reservations: [{ Instances: [{ State: { Name: 'running' } }] }],
      });
      mockKvsSend.mockResolvedValueOnce({ Value: 'running' });

      const res = (await handler({
        rawPath: '/__wakeup/status',
        requestContext: {},
      })) as any;
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.state).toBe('running');
    });
  });
});
