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

import inspector from 'node:inspector'
import fs from "node:fs";
import { parseIntEnvvar } from './common.js';

if (process.env.OTEL_TRACE_GC?.toLowerCase() === 'true') {
  console.log("Enabling GC traces");
  v8.setFlagsFromString('--trace-gc');
}

const instrumentations = initializeInstrumentations();
initializeProvider(instrumentations);
const lambdaInstrumentation = makeLambdaInstrumentation();

function scheduleTask(interval: number) {
  let profilingEnabled = process.env.OTEL_PROFILE?.toLowerCase() === 'true';
  let profilingThreshold = parseIntEnvvar('OTEL_PROFILING_THRESHOLD') ?? 1000;
  let profilingTime = parseIntEnvvar('OTEL_PROFILING_TIME') ?? 2500
  let lastExecutionTime = Date.now();
  let everProfiled = false;
  const session = new inspector.Session(); 

  function checkSchedulingError() {
      const currentTime = Date.now();
      const actualDelay = currentTime - lastExecutionTime;
      const error = actualDelay - interval;

      diag.debug(`Scheduled interval: ${interval}ms, Actual: ${actualDelay}ms, Error: ${error}ms`);
      lastExecutionTime = currentTime;

      if (error > profilingThreshold && !everProfiled && profilingEnabled) {
        startProfiling()
      } else {
        setTimeout(checkSchedulingError, interval);
      }

  }

  function startProfiling() {
    everProfiled = true;
    console.log("Staring profiling");
    session.connect();
    session.post("Profiler.enable", (err) => {
      if (err) {
        console.error(err);
      } else {
        session.post("Profiler.start", (err) => {
          if (err) {
            console.error(err);
          } else {
            setTimeout(endProfiling, profilingTime)
          }
        });
      }
    });
  }

  function endProfiling() {
    console.log("Ending profiling");
    session.post('Profiler.stop', (err, params) => {
      if (err) {
        console.error(err);
      } else {
        fs.writeFile("/tmp/profile.log", JSON.stringify(params.profile), (err) => {
          if (err) {
            console.error(err);
          } else {
            console.log("Finished profiling");
          }
        });
      }
    });
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