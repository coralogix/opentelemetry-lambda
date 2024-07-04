import { getEnv } from '@opentelemetry/core';

export const logLevel = getEnv().OTEL_LOG_LEVEL;
  
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
