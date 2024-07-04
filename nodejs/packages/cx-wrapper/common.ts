import { getEnv } from '@opentelemetry/core';
import { Instrumentation } from '@opentelemetry/instrumentation';
import { AwsLambdaInstrumentationConfig } from '@opentelemetry/instrumentation-aws-lambda';
import { MeterProvider, MeterProviderOptions } from '@opentelemetry/sdk-metrics';
import { SDKRegistrationConfig } from '@opentelemetry/sdk-trace-base';
import { NodeTracerConfig, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

export const logLevel = getEnv().OTEL_LOG_LEVEL;

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
  
export const OtelAttributes = {
    RPC_REQUEST_PAYLOAD: 'rpc.request.payload',
    RPC_RESPONSE_PAYLOAD: 'rpc.response.payload',
    DB_RESPONSE: 'db.response',
  };
  
export const parseIntEnvvar = (envName: string): number | undefined => {
    const envVar = process.env?.[envName];
    if (envVar === undefined) return undefined;
    const numericEnvvar = parseInt(envVar);
    if (isNaN(numericEnvvar)) return undefined;
    return numericEnvvar;
};
  
const DEFAULT_OTEL_PAYLOAD_SIZE_LIMIT = 50 * 1024;
export const OTEL_PAYLOAD_SIZE_LIMIT: number =
    parseIntEnvvar('OTEL_PAYLOAD_SIZE_LIMIT') ?? DEFAULT_OTEL_PAYLOAD_SIZE_LIMIT;
