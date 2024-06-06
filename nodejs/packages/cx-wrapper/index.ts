
import { load } from './aws/aws-user-function.js';
import {
  Callback,
  Context,
  Handler,
} from 'aws-lambda';

import { AwsLambdaInstrumentation } from '@opentelemetry/instrumentation-aws-lambda';
import {
  context as otelContext,
  defaultTextMapGetter,
  Context as OtelContext,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  propagation,
  Span,
  trace,
  metrics,
} from '@opentelemetry/api';

import { AwsLambdaInstrumentationConfig } from '@opentelemetry/instrumentation-aws-lambda';

const parseIntEnvvar = (envName: string): number | undefined => {
  const envVar = process.env?.[envName];
  if (envVar === undefined) return undefined;
  const numericEnvvar = parseInt(envVar);
  if (isNaN(numericEnvvar)) return undefined;
  return numericEnvvar;
};

const RPC_REQUEST_PAYLOAD: 'rpc.request.payload';
const DEFAULT_OTEL_PAYLOAD_SIZE_LIMIT = 50 * 1024;
const OTEL_PAYLOAD_SIZE_LIMIT: number =
  parseIntEnvvar('OTEL_PAYLOAD_SIZE_LIMIT') ?? DEFAULT_OTEL_PAYLOAD_SIZE_LIMIT;

const lambdaAutoInstrumentConfig: AwsLambdaInstrumentationConfig = {
  requestHook: (span, { event }) => {
    const data =
      event && typeof event === 'object'
        ? JSON.stringify(event)
        : event?.toString();
    if (data !== undefined) {
      span.setAttribute(
        RPC_REQUEST_PAYLOAD, //OtelAttributes.RPC_REQUEST_PAYLOAD,
        data.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
      );
    }
  },
  disableAwsContextPropagation: true,
  eventContextExtractor: (event, context) => {
    // try to extract propagation from http headers first
    const httpHeaders = event?.headers || {};
    const extractedHttpContext: OtelContext = propagation.extract(
      otelContext.active(),
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
            otelContext.active(),
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
            otelContext.active(),
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
    return otelContext.active();
  },
  payloadSizeLimit: OTEL_PAYLOAD_SIZE_LIMIT,
};

const instrumentation = new AwsLambdaInstrumentation(lambdaAutoInstrumentConfig)

if (process.env.CX_ORIGINAL_HANDLER === undefined)
  throw Error('CX_ORIGINAL_HANDLER is missing');

export const handler = async (event: any, context: Context, callback: Callback) => {
  console.log(`Running custom CX handler and redirecting to ${process.env.CX_ORIGINAL_HANDLER}`)

  const originalHandler = await load(
    process.env.LAMBDA_TASK_ROOT,
    process.env.CX_ORIGINAL_HANDLER
  );

  const patchedHandler = instrumentation.getPatchHandler(originalHandler)
  patchedHandler(event, context, callback)
}