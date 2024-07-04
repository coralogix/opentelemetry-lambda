import { diag, Span } from '@opentelemetry/api';
import { Instrumentation, registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsInstrumentation, NormalizedResponse } from '@opentelemetry/instrumentation-aws-sdk';
import { PgResponseHookInformation } from '@opentelemetry/instrumentation-pg';
import { OTEL_PAYLOAD_SIZE_LIMIT, OtelAttributes } from './common';

declare global {
  function configureInstrumentations(): Instrumentation[]
}

export function initializeInstrumentations(): any[] {
  diag.debug('Initializing OpenTelemetry instrumentations');
  
  const instrumentations = [
    new AwsInstrumentation({
      suppressInternalInstrumentation: true,
      preRequestHook: (span: Span, { request }) => {
        diag.debug(`preRequestHook for ${request.serviceName}.${request.commandName}`)

        const data = JSON.stringify(request.commandInput);
        if (data !== undefined) {
          span.setAttribute(
            OtelAttributes.RPC_REQUEST_PAYLOAD,
            data.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
          );
        }
      },
      responseHook: (span, { response }) => {
        diag.debug(`responseHook for ${response.request.serviceName}.${response.request.commandName}`)
        if (response.request.serviceName === 'S3') {
          if ('buckets' in response && Array.isArray(response.buckets)) {
            setResponsePayloadAttribute(span, JSON.stringify(response.buckets.map(b => b.Name)))
          } else if ('contents' in response && Array.isArray(response.contents)) {
            setResponsePayloadAttribute(span, JSON.stringify(response.contents.map(b => b.Key)))
          } else if ('data' in response && typeof response.data === 'object') {
            // data is too large and it contains cycles
          } else {
            const payload = responseDataToString(response)
            setResponsePayloadAttribute(span, payload)
          }
        } else {
          const payload = responseDataToString(response)
          setResponsePayloadAttribute(span, payload)
        }
      },
    }),
    ...(typeof configureInstrumentations === 'function' ? configureInstrumentations: defaultConfigureInstrumentations)()
  ];

  // Register instrumentations synchronously to ensure code is patched even before provider is ready.
  registerInstrumentations({
    instrumentations,
  });

  return instrumentations;
}

function responseDataToString(response: NormalizedResponse): string {
  return 'data' in response && typeof response.data === 'object'
    ? JSON.stringify(response.data)
    : response?.data?.toString();
}

function setResponsePayloadAttribute(span: Span, payload: string | undefined) {
  if (payload !== undefined) {
    span.setAttribute(
      OtelAttributes.RPC_RESPONSE_PAYLOAD,
      payload.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
    );
  }
}

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
    new MongoDBInstrumentation({
      enhancedDatabaseReporting: process.env.MONGO_ENHANCED_REPORTING === 'true'
    }),
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