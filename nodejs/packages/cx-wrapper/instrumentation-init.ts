import { diag, Span } from '@opentelemetry/api';
import { Instrumentation, registerInstrumentations } from '@opentelemetry/instrumentation';
import { NormalizedResponse, AwsSdkRequestHookInformation, AwsSdkResponseHookInformation } from '@opentelemetry/instrumentation-aws-sdk';
import { PgResponseHookInformation } from '@opentelemetry/instrumentation-pg';
import { OTEL_PAYLOAD_SIZE_LIMIT, OtelAttributes, parseBooleanEnvvar } from './common';
import { RequestOptions } from 'http';

declare global {
  function configureInstrumentations(): Instrumentation[]
}

export function initializeInstrumentations(): any[] {
  diag.debug('Initializing OpenTelemetry instrumentations');
  const instrumentations = (typeof configureInstrumentations === 'function' ? configureInstrumentations: defaultConfigureInstrumentations)();
  // Register instrumentations synchronously to ensure code is patched even before provider is ready.
  registerInstrumentations({instrumentations});
  return instrumentations;
}

function defaultConfigureInstrumentations(): Instrumentation[] {
  // Use require statements for instrumentation to avoid having to have transitive dependencies on all the typescript
  // definitions.
  const instrumentations: Instrumentation[] = [];
  
  const defaults = parseBooleanEnvvar("OTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED") ?? true;

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_DNS_ENABLED") ?? defaults) {
    const { DnsInstrumentation } = require('@opentelemetry/instrumentation-dns');
    instrumentations.push(new DnsInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_EXPRESS_ENABLED") ?? defaults) {
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    instrumentations.push(new ExpressInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_GRAPHQL_ENABLED") ?? defaults) {
    const { GraphQLInstrumentation } = require('@opentelemetry/instrumentation-graphql');
    instrumentations.push(new GraphQLInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_GRPC_ENABLED") ?? defaults) {
    const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');
    instrumentations.push(new GrpcInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_HAPI_ENABLED") ?? defaults) {
    const { HapiInstrumentation } = require('@opentelemetry/instrumentation-hapi');
    instrumentations.push(new HapiInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_HTTP_ENABLED") ?? defaults) {
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    instrumentations.push(new HttpInstrumentation({
      ignoreOutgoingRequestHook: (request: RequestOptions) =>
        request.hostname === "localhost" && Number(request.port) === 4318,
    }));
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_IOREDIS_ENABLED") ?? defaults) {
    const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
    instrumentations.push(new IORedisInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_KOA_ENABLED") ?? defaults) {
    const { KoaInstrumentation } = require('@opentelemetry/instrumentation-koa');
    instrumentations.push(new KoaInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_MONGODB_ENABLED") ?? defaults) {
    const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
    instrumentations.push(new MongoDBInstrumentation({
      enhancedDatabaseReporting: process.env.MONGO_ENHANCED_REPORTING === 'true'
    }));
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_MYSQL_ENABLED") ?? defaults) {
    const { MySQLInstrumentation } = require('@opentelemetry/instrumentation-mysql');
    instrumentations.push(new MySQLInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_NET_ENABLED") ?? defaults) {
    const { NetInstrumentation } = require('@opentelemetry/instrumentation-net');
    instrumentations.push(new NetInstrumentation());
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_PG_ENABLED") ?? defaults) {
    const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
    instrumentations.push(new PgInstrumentation({
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
    }));
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_REDIS_ENABLED") ?? defaults) {
    const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
    instrumentations.push(new RedisInstrumentation({
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
    }));
  }

  if (parseBooleanEnvvar("OTEL_INSTRUMENTATION_AWS_SDK_ENABLED") ?? defaults) {
    const { AwsInstrumentation } = require('@opentelemetry/instrumentation-aws-sdk');
    instrumentations.push(new AwsInstrumentation({
      suppressInternalInstrumentation: true,
      preRequestHook: (span: Span, { request }: AwsSdkRequestHookInformation) => {
        diag.debug(`preRequestHook for ${request.serviceName}.${request.commandName}`)

        const data = JSON.stringify(request.commandInput);
        if (data !== undefined) {
          span.setAttribute(
            OtelAttributes.RPC_REQUEST_PAYLOAD,
            data.substring(0, OTEL_PAYLOAD_SIZE_LIMIT)
          );
        }
      },
      responseHook: (span: Span, { response } : AwsSdkResponseHookInformation) => {
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
    }))
  }

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