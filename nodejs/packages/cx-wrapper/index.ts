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
        const maybePromise = patchedHandler(event, context, callback);
        diag.debug(`patchedHandler returned`);
        if (typeof maybePromise?.then === 'function') {
          diag.debug(`maybePromise is a promise`);
          maybePromise.then(
            value => {
              diag.debug(`maybePromise succeeded`);
              context.callbackWaitsForEmptyEventLoop = false;
              callback(null, value);
              diag.debug(`callback called`);
            },
            (err: Error | string | null | undefined) => {
              if (err === undefined || err === null) {
                diag.debug(`maybePromise failed with no error`);
                context.callbackWaitsForEmptyEventLoop = false;
                callback('handled', null);
                diag.debug(`callback called`);
              } else {
                diag.debug(`maybePromise failed`);
                context.callbackWaitsForEmptyEventLoop = false;
                callback(err, null);
                diag.debug(`callback called`);
              }
            }
          );
        }
      } catch (err: any) {
        diag.debug(`handler failed synchronously`);
        context.callbackWaitsForEmptyEventLoop = false;
        callback(err, null);
        diag.debug(`callback called`);
      }
    },
    (err: Error | string) => {
      diag.debug(`loading function failed`);
      context.callbackWaitsForEmptyEventLoop = false;
      callback(err, null)
      diag.debug(`callback called`);
    }
  );
}

diag.debug('OpenTelemetry instrumentation is ready');