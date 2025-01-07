import { diag, DiagConsoleLogger } from '@opentelemetry/api';
import { getEnv } from '@opentelemetry/core';

// configure lambda logging (before we load libraries that might log)
diag.setLogger(new DiagConsoleLogger(), getEnv().OTEL_LOG_LEVEL);

import { Callback, Context } from 'aws-lambda';
import { Handler } from "aws-lambda/handler.js";
import { load } from './loader.js';
import { initializeInstrumentations } from './instrumentation-init.js';
import { initializeProvider } from './provider-init.js';
import { makeLambdaInstrumentation } from './lambda-instrumentation-init.js';
import { parseBooleanEnvvar } from './common.js';

const instrumentations = initializeInstrumentations();
const tracerProvider = initializeProvider(instrumentations);
const lambdaInstrumentation = makeLambdaInstrumentation();

if (process.env.CX_ORIGINAL_HANDLER === undefined)
  throw Error('CX_ORIGINAL_HANDLER is missing');

// We want user code to get initialized during lambda init phase
try {
  (async () => {
    diag.debug(`Initialization: Loading original handler ${process.env.CX_ORIGINAL_HANDLER}`);
    await load(
      process.env.LAMBDA_TASK_ROOT,
      process.env.CX_ORIGINAL_HANDLER
    );
    diag.debug(`Initialization: Original handler loaded`);
  })();
} catch (e) {}

if (parseBooleanEnvvar("OTEL_WARM_UP_EXPORTER") ?? true) {
  // We want exporter code to get initialized during lambda init phase
  try {
    (async () => {
      try {
        diag.debug(`Initialization: warming up exporter`);
        const warmupSpan = tracerProvider.getTracer('cx-wrapper').startSpan('warmup');
        warmupSpan.setAttribute('cx.internal.span.role', 'warmup');
        warmupSpan.end();
        await tracerProvider.forceFlush();
        diag.debug(`Initialization: exporter warmed up`);
      } catch (e) {
        // The export may fail with timeout if the lambda instance gets frozen between init and the first invocation. We don't really care about that failure.
        // diag.error(`Initialization: exporter warmup failed: ${e}`);
      }
    })();
  } catch (e) {}
}

export const handler = (event: any, context: Context, callback: Callback) => {
  diag.debug(`Loading original handler ${process.env.CX_ORIGINAL_HANDLER}`);
  load(
    process.env.LAMBDA_TASK_ROOT,
    process.env.CX_ORIGINAL_HANDLER
  ).then(
    (originalHandler) => {
      try {
        diag.debug(`Instrumenting handler`);
        const patchedHandler = lambdaInstrumentation.getPatchHandler(originalHandler) as any as Handler;
        diag.debug(`Running CX handler and redirecting to ${process.env.CX_ORIGINAL_HANDLER}`)
        patchedHandler(event, context, callback);
      } catch (err: any) {
        context.callbackWaitsForEmptyEventLoop = false;
        callback(err, null);
      }
    },
    (err: Error | string) => {
      context.callbackWaitsForEmptyEventLoop = false;
      callback(err, null)
    }
  );
}

diag.debug('OpenTelemetry instrumentation is ready');