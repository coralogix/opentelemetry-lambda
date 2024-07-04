import { diag, Span } from '@opentelemetry/api';
import { Instrumentation, registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
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
    ...(typeof configureInstrumentations === 'function' ? configureInstrumentations: defaultConfigureInstrumentations)()
  ];

  // Register instrumentations synchronously to ensure code is patched even before provider is ready.
  registerInstrumentations({
    instrumentations,
  });

  return instrumentations;
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