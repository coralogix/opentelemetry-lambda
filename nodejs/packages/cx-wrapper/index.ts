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

const instrumentations = initializeInstrumentations();
initializeProvider(instrumentations);
const lambdaInstrumentation = makeLambdaInstrumentation();

if (process.env.CX_ORIGINAL_HANDLER === undefined)
  throw Error('CX_ORIGINAL_HANDLER is missing');

// We want user code to get initialized during lambda init phase
diag.debug(`Initialization: Loading original handler ${process.env.CX_ORIGINAL_HANDLER}`);
try {
  (async () => {
    await load(
      process.env.LAMBDA_TASK_ROOT,
      process.env.CX_ORIGINAL_HANDLER
    );
  })();
} catch (e) {}

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