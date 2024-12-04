import { diag, metrics } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { awsLambdaDetector } from '@opentelemetry/resource-detector-aws';
import { detectResourcesSync, envDetector, processDetector } from '@opentelemetry/resources';
import { MeterProvider, MeterProviderOptions, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, ConsoleSpanExporter, SDKRegistrationConfig, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerConfig, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
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

export function initializeProvider(instrumentations: any[]): void {
  diag.debug('Initializing OpenTelemetry providers');

  const export_timeout = parseIntEnvvar("OTEL_EXPORT_TIMEOUT") ?? DEFAULT_OTEL_EXPORT_TIMEOUT;

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
  process.env.OTEL_EXPORTER_OTLP_COMPRESSION = 'none';

  const tracerProvider = new NodeTracerProvider(config);
  /*
  if (typeof configureTracerProvider === 'function') {
    configureTracerProvider(tracerProvider)
  } else {
    // defaults
  */
  tracerProvider.addSpanProcessor(
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        timeoutMillis: export_timeout,
      }),
      {
        scheduledDelayMillis: 2147483647, // 24 days should be enough to outlive a lambda instance
      }
    )
  );
  /*
  }
  */

  if (parseBooleanEnvvar("OTEL_CONSOLE_SPAN_EXPORTER_ENABLED") ?? false) {
    tracerProvider.addSpanProcessor(
      new SimpleSpanProcessor(new ConsoleSpanExporter())
    );
  }

  let sdkRegistrationConfig: SDKRegistrationConfig = {};
  if (typeof configureSdkRegistration === 'function') {
    sdkRegistrationConfig = configureSdkRegistration(sdkRegistrationConfig);
  }
  tracerProvider.register(sdkRegistrationConfig);

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
}