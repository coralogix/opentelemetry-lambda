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

// Load the original handler during lambda initialization phase
diag.debug(`Init: Loading original handler from ${process.env.CX_ORIGINAL_HANDLER}`);
const originalHandler = await load(
  process.env.LAMBDA_TASK_ROOT,
  process.env.CX_ORIGINAL_HANDLER
)

diag.debug(`Instrumenting handler`);
const patchedHandler = lambdaInstrumentation.getPatchHandler(originalHandler) as any as Handler;

export const handler = (event: any, context: Context, callback: Callback) => {
  diag.debug(`Running CX handler and redirecting to ${process.env.CX_ORIGINAL_HANDLER}`)
  const maybePromise = patchedHandler(event, context, callback);
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
}

diag.debug('OpenTelemetry instrumentation is ready');