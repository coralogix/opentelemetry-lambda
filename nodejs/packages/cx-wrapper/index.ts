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

import v8 from 'v8';

if (process.env.OTEL_TRACE_GC?.toLowerCase() === 'true') {
  console.log("Enabling GC traces");
  v8.setFlagsFromString('--trace-gc');
}

const instrumentations = initializeInstrumentations();
initializeProvider(instrumentations);
const lambdaInstrumentation = makeLambdaInstrumentation();

function scheduleTask(interval: number) {
  let lastExecutionTime = Date.now();

  function checkSchedulingError() {
      const currentTime = Date.now();
      const actualDelay = currentTime - lastExecutionTime;
      const error = actualDelay - interval;

      diag.debug(`Scheduled interval: ${interval}ms, Actual: ${actualDelay}ms, Error: ${error}ms`);
      lastExecutionTime = currentTime;
      setTimeout(checkSchedulingError, interval);
  }

  setTimeout(checkSchedulingError, interval);
}

if (process.env.OTEL_SCHEDULING_ERROR_CHECK?.toLowerCase() === 'true') {
  scheduleTask(250);
}

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
        const maybePromise = patchedHandler(event, context, callback);
        if (typeof maybePromise?.then === 'function') {
          maybePromise.then(
            value => {
              context.callbackWaitsForEmptyEventLoop = false;
              callback(null, value);
            },
            (err: Error | string | null | undefined) => {
              if (err === undefined || err === null) {
                context.callbackWaitsForEmptyEventLoop = false;
                callback('handled', null);
              } else {
                context.callbackWaitsForEmptyEventLoop = false;
                callback(err, null);
              }
            }
          );
        }
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