import {
  defaultTextMapGetter,
  Context as OtelContext,
  propagation,
  trace,
  diag,
  ROOT_CONTEXT
} from '@opentelemetry/api';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsLambdaInstrumentation, AwsLambdaInstrumentationConfig } from '@opentelemetry/instrumentation-aws-lambda';
import { OTEL_PAYLOAD_SIZE_LIMIT, OtelAttributes } from './common.js';

declare global {
  function configureLambdaInstrumentation(config: AwsLambdaInstrumentationConfig): AwsLambdaInstrumentationConfig
}

export function makeLambdaInstrumentation(): AwsLambdaInstrumentation {
  diag.debug('Preparing handler function instrumentation');

  const lambdaAutoInstrumentConfig: AwsLambdaInstrumentationConfig = {
    requestHook: (span, { event }) => {
      const data =
        event && typeof event === 'object'
          ? JSON.stringify(event)
          : event?.toString();
      if (data !== undefined) {
        span.setAttribute(
          OtelAttributes.RPC_REQUEST_PAYLOAD,
          data.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
        );
      }
    },
    disableAwsContextPropagation: true,
    eventContextExtractor: (event, context) => {
      // try to extract propagation from http headers first
      const httpHeaders = event?.headers || {};
      const extractedHttpContext: OtelContext = propagation.extract(
        ROOT_CONTEXT,
        httpHeaders,
        defaultTextMapGetter
      );
      if (trace.getSpan(extractedHttpContext)?.spanContext()) {
        return extractedHttpContext;
      }

      // extract from client context
      if (context.clientContext?.Custom) {
        try {
          const extractedClientContextOtelContext: OtelContext =
            propagation.extract(
              ROOT_CONTEXT,
              context.clientContext.Custom,
              defaultTextMapGetter
            );
          if (trace.getSpan(extractedClientContextOtelContext)?.spanContext()) {
            return extractedClientContextOtelContext;
          }
        } catch (e) {
          diag.debug(
            'error extracting context from lambda client context payload',
            e
          );
        }
      } else if ((context.clientContext as any)?.custom) {
        try {
          const extractedClientContextOtelContext: OtelContext =
            propagation.extract(
              ROOT_CONTEXT,
              (context.clientContext as any).custom,
              defaultTextMapGetter
            );
          if (trace.getSpan(extractedClientContextOtelContext)?.spanContext()) {
            return extractedClientContextOtelContext;
          }
        } catch (e) {
          diag.debug(
            'error extracting context from lambda client context payload',
            e
          );
        }
      }
      return ROOT_CONTEXT;
    },
    payloadSizeLimit: OTEL_PAYLOAD_SIZE_LIMIT,
  };

  // TODO consider not treating it as an instrumentation
  const instrumentation = new AwsLambdaInstrumentation(typeof configureLambdaInstrumentation === 'function' ? configureLambdaInstrumentation(lambdaAutoInstrumentConfig) : lambdaAutoInstrumentConfig)

  registerInstrumentations({instrumentations: [instrumentation]})

  return instrumentation
}