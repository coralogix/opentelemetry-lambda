import {
  defaultTextMapGetter,
  Context as OtelContext,
  propagation,
  diag,
  ROOT_CONTEXT,
  trace,
} from '@opentelemetry/api';
import type { Context } from 'aws-lambda';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsLambdaInstrumentation, AwsLambdaInstrumentationConfig } from '@opentelemetry/instrumentation-aws-lambda';
import { findLambdaTrigger } from '@opentelemetry/instrumentation-aws-lambda';
import { OTEL_PAYLOAD_SIZE_LIMIT, OtelAttributes } from './common.js';

declare global {
  function configureLambdaInstrumentation(config: AwsLambdaInstrumentationConfig): AwsLambdaInstrumentationConfig
}

function headerContextExtractor(event: any): OtelContext | undefined {
  if (!event?.headers) {
    return undefined;
  }
  return propagation.extract(ROOT_CONTEXT, event.headers, defaultTextMapGetter);
}

function clientContextExtractor(_event: any, context: Context): OtelContext | undefined {
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
  return undefined;
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
    eventContextExtractor: (event: any, context: Context): OtelContext => {
      const headerContext = headerContextExtractor(event);
      const clientContext = clientContextExtractor(event, context);
      const triggerContext = findLambdaTrigger(event)?.contextExtractor?.(event);
      const extractedContext = [headerContext, clientContext, triggerContext]
        .find((context: OtelContext | undefined) => context !== undefined) ?? ROOT_CONTEXT;
      return extractedContext;
    },
    payloadSizeLimit: OTEL_PAYLOAD_SIZE_LIMIT,
  };

  // TODO consider not treating it as an instrumentation
  const instrumentation = new AwsLambdaInstrumentation(typeof configureLambdaInstrumentation === 'function' ? configureLambdaInstrumentation(lambdaAutoInstrumentConfig) : lambdaAutoInstrumentConfig)

  registerInstrumentations({ instrumentations: [instrumentation] })

  return instrumentation
}
