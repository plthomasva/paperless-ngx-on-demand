import { Construct } from 'constructs';
import {
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionRuntime,
  FunctionEventType,
  ViewerProtocolPolicy,
  AllowedMethods,
  CachePolicy,
  OriginRequestPolicy,
  KeyValueStore,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Fn } from 'aws-cdk-lib';
import { FunctionUrl } from 'aws-cdk-lib/aws-lambda';

export interface EdgeRouterProps {
  readonly wakeupFunctionUrl: FunctionUrl;
  readonly originVerifySecret: string;
  readonly keyValueStore: KeyValueStore;
}

export class EdgeRouter extends Construct {
  public readonly distribution: Distribution;
  public readonly routerFunction: CloudFrontFunction;

  constructor(scope: Construct, id: string, props: EdgeRouterProps) {
    super(scope, id);

    // CloudFront Function using runtime 2.0 with KVS integration
    const routerFunctionCode = `
import cf from 'cloudfront';

async function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Status check and wake-up paths go straight to the default origin (Lambda Function URL)
  if (uri.startsWith('/__wakeup')) {
    return request;
  }

  try {
    const kvs = cf.kvs();
    var status = await kvs.get('status');
    var originDomain = await kvs.get('originDomain');

    if (status === 'running' && originDomain && originDomain.length > 0) {
      cf.updateRequestOrigin({
        domainName: originDomain,
        customOriginConfig: {
          port: 8000,
          protocol: 'http',
          sslProtocols: ['TLSv1.2']
        }
      });

      // Preserve viewer Host header as x-forwarded-host
      if (request.headers['host']) {
        request.headers['x-forwarded-host'] = { value: request.headers['host'].value };
      }
    }
  } catch (err) {
    // On KVS lookup failure or cold state, route to default origin (Lambda splash screen)
  }

  return request;
}
`;

    this.routerFunction = new CloudFrontFunction(this, 'DynamicOriginRouter', {
      code: FunctionCode.fromInline(routerFunctionCode),
      runtime: FunctionRuntime.JS_2_0,
      keyValueStore: props.keyValueStore,
      comment: 'Dynamic origin router checking KVS for warm Paperless-NGX instance',
    });

    // Extract hostname from Lambda Function URL (https://<domain>/)
    const wakeupDomain = Fn.select(2, Fn.split('/', props.wakeupFunctionUrl.url));

    const defaultOrigin = new HttpOrigin(wakeupDomain, {
      customHeaders: {
        'x-origin-verify': props.originVerifySecret,
      },
    });

    // CloudFront Distribution
    this.distribution = new Distribution(this, 'Distribution', {
      comment: 'Paperless-NGX On-Demand Distribution',
      defaultBehavior: {
        origin: defaultOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [
          {
            function: this.routerFunction,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });
  }
}
