import { context, diag, metrics, propagation, trace, ContextManager, TextMapPropagator } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, getNumberFromEnv, getStringFromEnv, merge, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { awsLambdaDetector } from '@opentelemetry/resource-detector-aws';
import { detectResources, envDetector, processDetector } from '@opentelemetry/resources';
import { MeterProvider, MeterProviderOptions, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { AlwaysOffSampler, AlwaysOnSampler, BatchSpanProcessor, ConsoleSpanExporter, ParentBasedSampler, Sampler, SimpleSpanProcessor, SpanLimits, SpanProcessor, TraceIdRatioBasedSampler, TracerProvider, TracerProviderOptions } from '@opentelemetry/sdk-trace';

// Preserve the wrapper's configuration hooks after removal of the SDK2 shims.
export type NodeTracerConfig = TracerProviderOptions & {
  generalLimits?: Pick<SpanLimits, 'attributeCountLimit' | 'attributeValueLengthLimit'>;
  forceFlushTimeoutMillis?: number;
};

export interface SDKRegistrationConfig {
  contextManager?: ContextManager | null;
  propagator?: TextMapPropagator | null;
}
import { parseBooleanEnvvar, parseIntEnvvar } from './common';

declare global {
    // in case of downstream configuring span processors etc
    // function configureTracerProvider(tracerProvider: NodeTracerProvider): void; // TODO restore support for this
    function configureTracer(defaultConfig: NodeTracerConfig): NodeTracerConfig;
    function configureSdkRegistration(
      defaultSdkRegistration: SDKRegistrationConfig
    ): SDKRegistrationConfig;
    function configureMeter(defaultConfig: MeterProviderOptions): MeterProviderOptions;
    function configureMeterProvider(meterProvider: MeterProvider): void
}
  
const DEFAULT_OTEL_EXPORT_TIMEOUT = 2000; // this is a localhost call, and we don't want to block the function for too long

export function initializeProvider(instrumentations: any[]): TracerProvider {
  diag.debug('Initializing OpenTelemetry providers');

  const export_timeout = parseIntEnvvar("OTEL_EXPORT_TIMEOUT") ?? DEFAULT_OTEL_EXPORT_TIMEOUT;

  const resource = detectResources({
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
  process.env.OTEL_EXPORTER_OTLP_COMPRESSION = 'none';

  const spanProcessors: SpanProcessor[] = [
    new BatchSpanProcessor({
      exporter: new OTLPTraceExporter({
        timeoutMillis: export_timeout,
      }),
      maxQueueSize: getNumberFromEnv('OTEL_BSP_MAX_QUEUE_SIZE'),
      maxExportBatchSize: getNumberFromEnv('OTEL_BSP_MAX_EXPORT_BATCH_SIZE'),
      exportTimeoutMillis: getNumberFromEnv('OTEL_BSP_EXPORT_TIMEOUT'),
      scheduledDelayMillis: 2147483647, // keep exports invocation-driven
    }),
  ];

  if (parseBooleanEnvvar("OTEL_CONSOLE_SPAN_EXPORTER_ENABLED") ?? false) {
    spanProcessors.push(new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() }));
  }

  // SDK3 no longer reads these environment variables. Preserve the SDK2
  // fallback order, including the legacy generalLimits configuration hook.
  const tracerConfig: TracerProviderOptions = merge({}, tracerDefaultsFromEnv(), config);
  tracerConfig.spanLimits = {
    ...tracerConfig.spanLimits,
    attributeCountLimit: config.spanLimits?.attributeCountLimit ??
      config.generalLimits?.attributeCountLimit ??
      getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT') ??
      getNumberFromEnv('OTEL_ATTRIBUTE_COUNT_LIMIT') ?? 128,
    attributeValueLengthLimit: config.spanLimits?.attributeValueLengthLimit ??
      config.generalLimits?.attributeValueLengthLimit ??
      getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT') ??
      getNumberFromEnv('OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT') ?? Infinity,
  };
  // The wrapper has always owned its processor pipeline, even if the hook
  // supplies spanProcessors. Keep that precedence unchanged.
  tracerConfig.spanProcessors = spanProcessors;
  const tracerProvider = new TracerProvider(tracerConfig);
  if (config.forceFlushTimeoutMillis !== undefined) {
    const forceFlush = tracerProvider.forceFlush.bind(tracerProvider);
    tracerProvider.forceFlush = options => forceFlush({
      timeoutMillis: config.forceFlushTimeoutMillis,
      ...options,
    });
  }

  let sdkRegistrationConfig: SDKRegistrationConfig = {};
  if (typeof configureSdkRegistration === 'function') {
    sdkRegistrationConfig = configureSdkRegistration(sdkRegistrationConfig);
  }
  trace.setGlobalTracerProvider(tracerProvider);
  if (sdkRegistrationConfig.contextManager !== null) {
    const contextManager = sdkRegistrationConfig.contextManager ??
      new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
  }
  if (sdkRegistrationConfig.propagator !== null) {
    propagation.setGlobalPropagator(sdkRegistrationConfig.propagator ??
      new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
      }));
  }

  // Configure default meter provider

  const metricExporter = new OTLPMetricExporter({
    timeoutMillis: export_timeout,
    temporalityPreference: AggregationTemporality.CUMULATIVE,
  });

  let meterConfig: MeterProviderOptions = {
    resource,
    readers: [new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 2147483647, // 24 days should be enough to outlive a lambda instance
    })]
  }
  if (typeof configureMeter === 'function') {
    meterConfig = configureMeter(meterConfig);
  }

  const meterProvider = new MeterProvider(meterConfig);
  if (typeof configureMeterProvider === 'function') {
    configureMeterProvider(meterProvider)
  }
  metrics.setGlobalMeterProvider(meterProvider);

  // Re-register instrumentation with initialized provider. Patched code will see the update.
  registerInstrumentations({
    instrumentations,
    tracerProvider,
    meterProvider
  });

  return tracerProvider
}


function tracerDefaultsFromEnv(): TracerProviderOptions {
  return {
    sampler: samplerFromEnv(),
    spanLimits: {
      attributeValueLengthLimit: getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT') ?? Infinity,
      attributeCountLimit: getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT') ?? 128,
      linkCountLimit: getNumberFromEnv('OTEL_SPAN_LINK_COUNT_LIMIT') ?? 128,
      eventCountLimit: getNumberFromEnv('OTEL_SPAN_EVENT_COUNT_LIMIT') ?? 128,
      attributePerEventCountLimit: getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT') ?? 128,
      attributePerLinkCountLimit: getNumberFromEnv('OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT') ?? 128,
    },
  };
}

function samplerFromEnv(): Sampler {
  const sampler = getStringFromEnv('OTEL_TRACES_SAMPLER') ?? 'parentbased_always_on';
  switch (sampler) {
    case 'always_on': return new AlwaysOnSampler();
    case 'always_off': return new AlwaysOffSampler();
    case 'parentbased_always_on': return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    case 'parentbased_always_off': return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case 'traceidratio': return new TraceIdRatioBasedSampler(samplingRatioFromEnv());
    case 'parentbased_traceidratio':
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(samplingRatioFromEnv()) });
    default:
      diag.error(`OTEL_TRACES_SAMPLER value "${sampler}" invalid, defaulting to "parentbased_always_on".`);
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
  }
}

function samplingRatioFromEnv(): number {
  const ratio = getNumberFromEnv('OTEL_TRACES_SAMPLER_ARG');
  if (ratio === undefined || ratio < 0 || ratio > 1) {
    diag.error('Invalid or missing OTEL_TRACES_SAMPLER_ARG, defaulting to 1.');
    return 1;
  }
  return ratio;
}
