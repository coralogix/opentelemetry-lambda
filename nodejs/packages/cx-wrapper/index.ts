
import { load } from 'cx-aws-user-function';
import {
  Callback,
  Context,
} from 'aws-lambda';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsLambdaInstrumentation } from '@opentelemetry/instrumentation-aws-lambda';
import {
  context as otelContext,
  defaultTextMapGetter,
  Context as OtelContext,
  diag,
  propagation,
  trace,
} from '@opentelemetry/api';
import { AwsLambdaInstrumentationConfig } from '@opentelemetry/instrumentation-aws-lambda';
import {Handler} from "aws-lambda/handler";

const parseIntEnvvar = (envName: string): number | undefined => {
  const envVar = process.env?.[envName];
  if (envVar === undefined) return undefined;
  const numericEnvvar = parseInt(envVar);
  if (isNaN(numericEnvvar)) return undefined;
  return numericEnvvar;
};

const RPC_REQUEST_PAYLOAD = 'rpc.request.payload';
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

registerInstrumentations({instrumentations: [instrumentation]})

if (process.env.CX_ORIGINAL_HANDLER === undefined)
  throw Error('CX_ORIGINAL_HANDLER is missing');



export const handler = (event: any, context: Context, callback: Callback) => {
  // console.log(`Running custom CX handler and redirecting to ${process.env.CX_ORIGINAL_HANDLER}`)
  load(
    process.env.LAMBDA_TASK_ROOT,
    process.env.CX_ORIGINAL_HANDLER
  ).then(
    originalHandler => {
      const patchedHandler = instrumentation.getPatchHandler(originalHandler) as any as Handler;
      const maybePromise = patchedHandler(event, context, callback);
      // console.log("patchedHandler completed")
      if (typeof maybePromise?.then === 'function') {
        maybePromise.then(
          value => {
            callback(null, value)
          },
          (err: Error | string) => {
            callback(err, null)
          }
        );
      }
    },
    (err: Error | string) => {
      callback(err, null)
    }
  );
}
