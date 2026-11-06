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
  OriginProtocolPolicy,
  KeyValueStore,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Fn } from 'aws-cdk-lib';
import { FunctionUrl } from 'aws-cdk-lib/aws-lambda';
import { Certificate, CertificateValidation, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';

export interface EdgeRouterProps {
  readonly wakeupFunctionUrl: FunctionUrl;
  readonly originVerifySecret: string;
  readonly keyValueStore: KeyValueStore;
  readonly domainName?: string;
  readonly certificateArn?: string;
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
      protocolPolicy: OriginProtocolPolicy.MATCH_VIEWER,
      httpPort: 8000,
      customHeaders: {
        'x-origin-verify': props.originVerifySecret,
      },
    });

    // Handle optional custom domain and ACM certificate
    let certificate: ICertificate | undefined;
    if (props.domainName) {
      if (props.certificateArn) {
        certificate = Certificate.fromCertificateArn(
          this,
          'CustomDomainCert',
          props.certificateArn
        );
      } else {
        certificate = new Certificate(this, 'CustomDomainCert', {
          domainName: props.domainName,
          validation: CertificateValidation.fromDns(),
        });
      }
    }

    // CloudFront Distribution
    this.distribution = new Distribution(this, 'Distribution', {
      comment: 'Paperless-NGX On-Demand Distribution',
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate,
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
