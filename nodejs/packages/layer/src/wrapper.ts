import {
  NodeTracerConfig,
  NodeTracerProvider,
} from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SDKRegistrationConfig,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Instrumentation, registerInstrumentations } from '@opentelemetry/instrumentation';
import { awsLambdaDetector } from '@opentelemetry/resource-detector-aws';
import {
  detectResourcesSync,
  envDetector,
  processDetector,
} from '@opentelemetry/resources';
import { AwsInstrumentation } from '@coralogix/instrumentation-aws-sdk';
import { AwsLambdaInstrumentation } from '@coralogix/instrumentation-aws-lambda';
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
} from '@opentelemetry/api';
import { getEnv } from '@opentelemetry/core';
import { AwsLambdaInstrumentationConfig } from '@coralogix/instrumentation-aws-lambda';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PgResponseHookInformation } from '@opentelemetry/instrumentation-pg';

import { MeterProvider, MeterProviderOptions } from '@opentelemetry/sdk-metrics';


function defaultConfigureInstrumentations() {
  // Use require statements for instrumentation to avoid having to have transitive dependencies on all the typescript
  // definitions.
  const { DnsInstrumentation } = require('@opentelemetry/instrumentation-dns');
  const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
  const { GraphQLInstrumentation } = require('@opentelemetry/instrumentation-graphql');
  const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');
  const { HapiInstrumentation } = require('@opentelemetry/instrumentation-hapi');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
  const { KoaInstrumentation } = require('@opentelemetry/instrumentation-koa');
  const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
  const { MySQLInstrumentation } = require('@opentelemetry/instrumentation-mysql');
  const { NetInstrumentation } = require('@opentelemetry/instrumentation-net');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
  const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
  return [ new DnsInstrumentation(),
    new ExpressInstrumentation(),
    new GraphQLInstrumentation(),
    new GrpcInstrumentation(),
    new HapiInstrumentation(),
    new HttpInstrumentation(),
    new IORedisInstrumentation(),
    new KoaInstrumentation(),
    new MongoDBInstrumentation(),
    new MySQLInstrumentation(),
    new NetInstrumentation(),
    new PgInstrumentation({
      responseHook: (span: Span, responseInfo: PgResponseHookInformation) => {
        try {
          if (responseInfo?.data?.rows) {
            const data = JSON.stringify(responseInfo?.data?.rows);
            span.setAttribute(
              OtelAttributes.DB_RESPONSE,
              data.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
            );
          }
        } catch (e) {
          return;
        }
      },
    }),
    new RedisInstrumentation({
      responseHook: (
        span: Span,
        cmdName: string,
        cmdArgs: string[],
        response: unknown
      ) => {
        const data =
          response && typeof response === 'object'
            ? JSON.stringify(response)
            : response?.toString();
        if (data !== undefined) {
          span.setAttribute(
            OtelAttributes.DB_RESPONSE,
            data.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
          );
        }
      },
    }),
  ]
}

declare global {
  // in case of downstream configuring span processors etc
  function configureTracerProvider(tracerProvider: NodeTracerProvider): void;

  function configureTracer(defaultConfig: NodeTracerConfig): NodeTracerConfig;

  function configureSdkRegistration(
    defaultSdkRegistration: SDKRegistrationConfig
  ): SDKRegistrationConfig;
  function configureMeter(defaultConfig: MeterProviderOptions): MeterProviderOptions;
  function configureMeterProvider(meterProvider: MeterProvider): void
  function configureLambdaInstrumentation(config: AwsLambdaInstrumentationConfig): AwsLambdaInstrumentationConfig
  function configureInstrumentations(): Instrumentation[]
}

const OtelAttributes = {
  RPC_REQUEST_PAYLOAD: 'rpc.request.payload',
  RPC_RESPONSE_PAYLOAD: 'rpc.response.payload',
  DB_RESPONSE: 'db.response',
};

const DEFAULT_OTEL_PAYLOAD_SIZE_LIMIT = 50 * 1024;

const parseIntEnvvar = (envName: string): number | undefined => {
  const envVar = process.env?.[envName];
  if (envVar === undefined) return undefined;
  const numericEnvvar = parseInt(envVar);
  if (isNaN(numericEnvvar)) return undefined;
  return numericEnvvar;
};

const OTEL_PAYLOAD_SIZE_LIMIT: number =
  parseIntEnvvar('OTEL_PAYLOAD_SIZE_LIMIT') ?? DEFAULT_OTEL_PAYLOAD_SIZE_LIMIT;

console.log('Registering OpenTelemetry');
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
    const httpHeaders = event.headers || {};
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
};

const instrumentations = [
  new AwsInstrumentation({
    suppressInternalInstrumentation: true,
    preRequestHook: (span: Span, { request }) => {
      const data = JSON.stringify(request.commandInput);
      if (data !== undefined) {
        span.setAttribute(
          OtelAttributes.RPC_REQUEST_PAYLOAD,
          data.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
        );
      }
    },
    responseHook: (span, { response }) => {
      const data =
        'data' in response && typeof response.data === 'object'
          ? JSON.stringify(response.data)
          : response?.data?.toString();
      if (data !== undefined) {
        span.setAttribute(
          OtelAttributes.RPC_RESPONSE_PAYLOAD,
          data.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
        );
      }
    },
  }),
  new AwsLambdaInstrumentation(typeof configureLambdaInstrumentation === 'function' ? configureLambdaInstrumentation(lambdaAutoInstrumentConfig) : lambdaAutoInstrumentConfig),
  ...(typeof configureInstrumentations === 'function' ? configureInstrumentations: defaultConfigureInstrumentations)()
];

// configure lambda logging
const logLevel = getEnv().OTEL_LOG_LEVEL;
diag.setLogger(new DiagConsoleLogger(), logLevel);

// Register instrumentations synchronously to ensure code is patched even before provider is ready.
registerInstrumentations({
  instrumentations,
});

async function initializeProvider() {
  const resource = detectResourcesSync({
    detectors: [awsLambdaDetector, envDetector, processDetector],
  });

  let config: NodeTracerConfig = {
    resource,
  };
  if (typeof configureTracer === 'function') {
    config = configureTracer(config);
  }

  // manually set OTEL_TRACES_EXPORTER to null to error
  // undefined ERROR Exporter "otlp" requested through environment variable is unavailable.
  process.env.OTEL_TRACES_EXPORTER = 'none';

  const tracerProvider = new NodeTracerProvider(config);
  /*
  if (typeof configureTracerProvider === 'function') {
    configureTracerProvider(tracerProvider)
  } else {
    // defaults
  */
  tracerProvider.addSpanProcessor(
    new BatchSpanProcessor(new OTLPTraceExporter())
  );
  /*
  }
  */
  // logging for debug
  if (logLevel === DiagLogLevel.DEBUG) {
    tracerProvider.addSpanProcessor(
      new SimpleSpanProcessor(new ConsoleSpanExporter())
    );
  }

  let sdkRegistrationConfig: SDKRegistrationConfig = {};
  if (typeof configureSdkRegistration === 'function') {
    sdkRegistrationConfig = configureSdkRegistration(sdkRegistrationConfig);
  }
  tracerProvider.register(sdkRegistrationConfig);

  // Configure default meter provider (doesn't export metrics)
  let meterConfig: MeterProviderOptions = {
    resource,
  }
  if (typeof configureMeter === 'function') {
    meterConfig = configureMeter(meterConfig);
  }

  const meterProvider = new MeterProvider(meterConfig);
  if (typeof configureMeterProvider === 'function') {
    configureMeterProvider(meterProvider)
  }

  // Re-register instrumentation with initialized provider. Patched code will see the update.
  registerInstrumentations({
    instrumentations,
    tracerProvider,
    meterProvider
  });
}

initializeProvider();
