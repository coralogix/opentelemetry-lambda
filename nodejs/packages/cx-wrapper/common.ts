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

export const parseBooleanEnvvar = (envName: string): boolean | undefined => {
  const envVar = process.env?.[envName];
  if (envVar === undefined) return undefined;
  const lowerCaseEnvVar = envVar.toLowerCase();
  if (lowerCaseEnvVar === 'true' || lowerCaseEnvVar === 't') {
    return true;
  } else if (lowerCaseEnvVar === 'false' || lowerCaseEnvVar === 'f') {
    return false 
  } else {
    return undefined;
  }
};
  
const DEFAULT_OTEL_PAYLOAD_SIZE_LIMIT = 50 * 1024;
export const OTEL_PAYLOAD_SIZE_LIMIT: number =
    parseIntEnvvar('OTEL_PAYLOAD_SIZE_LIMIT') ?? DEFAULT_OTEL_PAYLOAD_SIZE_LIMIT;
