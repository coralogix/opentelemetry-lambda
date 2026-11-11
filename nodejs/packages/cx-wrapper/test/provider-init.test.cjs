const assert = require('node:assert/strict');
const { test } = require('node:test');
const api = require('@opentelemetry/api');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const { AlwaysOnSampler, AggregationTemporality } = {
  ...require('@opentelemetry/sdk-trace'),
  ...require('@opentelemetry/sdk-metrics'),
};
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { initializeProvider } = require('../provider-init.js');
const hooks = ['configureTracer', 'configureSdkRegistration', 'configureMeter', 'configureMeterProvider'];

function resetGlobals() {
  api.trace.disable();
  api.context.disable();
  api.propagation.disable();
  api.metrics.disable();
}

function setup(t, env = {}, options = {}) {
  resetGlobals();
  const savedEnv = { ...process.env };
  const savedHooks = Object.fromEntries(hooks.map(name => [name, global[name]]));
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('OTEL_')) delete process.env[key];
  }
  Object.assign(process.env, env);
  for (const name of hooks) delete global[name];
  const batches = [], metricBatches = [];
  const traceExport = OTLPTraceExporter.prototype.export;
  const metricExport = OTLPMetricExporter.prototype.export;
  OTLPTraceExporter.prototype.export = options.export || ((spans, callback) => {
    batches.push(spans);
    callback({ code: 0 });
  });
  OTLPMetricExporter.prototype.export = (data, callback) => {
    metricBatches.push(data);
    callback({ code: 0 });
  };
  if (options.tracer) global.configureTracer = options.tracer;
  if (options.registration) global.configureSdkRegistration = options.registration;
  let meterProvider, meterConfig;
  global.configureMeter = config => { meterConfig = config; return config; };
  global.configureMeterProvider = provider => { meterProvider = provider; };
  options.beforeInitialize?.();
  const provider = initializeProvider([]);
  t.after(async () => {
    await provider.shutdown();
    await meterProvider.shutdown();
    resetGlobals();
    OTLPTraceExporter.prototype.export = traceExport;
    OTLPMetricExporter.prototype.export = metricExport;
    for (const name of hooks) {
      if (savedHooks[name] === undefined) delete global[name];
      else global[name] = savedHooks[name];
    }
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('OTEL_')) delete process.env[key];
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (key.startsWith('OTEL_')) process.env[key] = value;
    }
  });
  return { provider, tracer: provider.getTracer('provider-tests'), batches, metricBatches, meterProvider, meterConfig };
}

for (const sampler of ['always_off', 'traceidratio', 'parentbased_always_off', 'parentbased_traceidratio']) {
  test(`${sampler} preserves environment sampling decisions`, async t => {
    const c = setup(t, { OTEL_TRACES_SAMPLER: sampler, OTEL_TRACES_SAMPLER_ARG: '0' });
    const span = c.tracer.startSpan('not-recorded');
    assert.equal(span.isRecording(), false);
    span.end();
    await c.provider.forceFlush();
    assert.equal(c.batches.length, 0);
  });
}

test('explicit sampler overrides environment selection', async t => {
  const c = setup(t, { OTEL_TRACES_SAMPLER: 'always_off' }, { tracer: config => ({ ...config, sampler: new AlwaysOnSampler() }) });
  c.tracer.startSpan('explicit-on').end();
  await c.provider.forceFlush();
  assert.equal(c.batches.flat().length, 1);
});

for (const value of ['invalid', '-1', '2', '']) {
  test(`ratio argument ${JSON.stringify(value)} falls back to one`, async t => {
    const c = setup(t, { OTEL_TRACES_SAMPLER: 'traceidratio', OTEL_TRACES_SAMPLER_ARG: value });
    assert.equal(c.tracer.startSpan('sampled').isRecording(), true);
  });
}

test('attribute count/value generic env fallbacks apply to exported spans', async t => {
  const c = setup(t, { OTEL_ATTRIBUTE_COUNT_LIMIT: '1', OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT: '3' });
  const span = c.tracer.startSpan('limits');
  span.setAttribute('first', 'abcdef');
  span.setAttribute('dropped', 'other');
  span.end();
  await c.provider.forceFlush();
  assert.deepEqual(c.batches.flat()[0].attributes, { first: 'abc' });
});

test('span env overrides generic env and explicit span limits override legacy general limits', async t => {
  const c = setup(t, {
    OTEL_ATTRIBUTE_COUNT_LIMIT: '1', OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT: '2',
    OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT: '1', OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT: '2',
  }, { tracer: config => ({ ...config, generalLimits: { attributeCountLimit: 3, attributeValueLengthLimit: 3 }, spanLimits: { attributeCountLimit: 1, attributeValueLengthLimit: 4 } }) });
  const span = c.tracer.startSpan('explicit-limits');
  span.setAttribute('first', 'abcdef'); span.setAttribute('dropped', 'other'); span.end();
  await c.provider.forceFlush();
  assert.deepEqual(c.batches.flat()[0].attributes, { first: 'abcd' });
});

test('legacy general limits override env and preserve zero', async t => {
  const c = setup(t, { OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT: '2' }, { tracer: config => ({ ...config, generalLimits: { attributeCountLimit: 0 } }) });
  const span = c.tracer.startSpan('zero-limit'); span.setAttribute('dropped', 'value'); span.end();
  await c.provider.forceFlush();
  assert.deepEqual(c.batches.flat()[0].attributes, {});
});

test('event/link counts and their attribute env limits apply', async t => {
  const c = setup(t, { OTEL_SPAN_EVENT_COUNT_LIMIT: '1', OTEL_SPAN_LINK_COUNT_LIMIT: '1', OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT: '1', OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT: '1' });
  const link = { context: { traceId: '12345678901234567890123456789012', spanId: '1234567890123456', traceFlags: 1 }, attributes: { one: 1, two: 2 } };
  const span = c.tracer.startSpan('events-links', { links: [link, link] });
  span.addEvent('one', { one: 1, two: 2 }); span.addEvent('two', { one: 1, two: 2 }); span.end();
  await c.provider.forceFlush();
  const exported = c.batches.flat()[0];
  assert.equal(exported.events.length, 1); assert.equal(Object.keys(exported.events[0].attributes).length, 1);
  assert.equal(exported.links.length, 1); assert.equal(Object.keys(exported.links[0].attributes).length, 1);
});

test('BSP queue/batch env settings bound real export batches and suppress periodic timer override', async t => {
  const c = setup(t, { OTEL_BSP_MAX_QUEUE_SIZE: '8', OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '2', OTEL_BSP_EXPORT_TIMEOUT: '50', OTEL_BSP_SCHEDULE_DELAY: '1' });
  const processor = c.provider._activeSpanProcessor._spanProcessors[0];
  assert.equal(processor._maxQueueSize, 8); assert.equal(processor._exportTimeoutMillis, 50); assert.equal(processor._scheduledDelayMillis, 2147483647);
  for (let i = 0; i < 5; i++) c.tracer.startSpan(`batch-${i}`).end();
  await c.provider.forceFlush();
  assert.equal(c.batches.flat().length, 5); assert.ok(c.batches.every(batch => batch.length <= 2));
});

test('BSP export timeout rejects a pending export', async t => {
  const c = setup(t, { OTEL_BSP_EXPORT_TIMEOUT: '5' }, { export: () => {} });
  c.tracer.startSpan('pending-export').end();
  await assert.rejects(c.provider.forceFlush());
});

test('legacy forceFlush timeout is honored and per-call timeout takes priority', async t => {
  const c = setup(t, { OTEL_BSP_EXPORT_TIMEOUT: '200' }, {
    tracer: config => ({ ...config, forceFlushTimeoutMillis: 5 }),
    export: (_spans, callback) => setTimeout(() => callback({ code: 0 }), 30),
  });
  c.tracer.startSpan('legacy-timeout').end();
  await assert.rejects(c.provider.forceFlush());
  await new Promise(resolve => setTimeout(resolve, 40));
  c.tracer.startSpan('per-call-timeout').end();
  await c.provider.forceFlush({ timeoutMillis: 100 });
});

test('default registration installs asynchronous context and W3C+baggage propagation', async t => {
  setup(t, { OTEL_PROPAGATORS: 'none' });
  assert.deepEqual(api.propagation.fields(), ['traceparent', 'tracestate', 'baggage']);
  const key = api.createContextKey('async-test');
  await api.context.with(api.context.active().setValue(key, 'present'), async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(api.context.active().getValue(key), 'present');
  });
});

test('null registration preserves previously registered context and propagator', async t => {
  const manager = new AsyncLocalStorageContextManager();
  const propagator = { inject() {}, extract: context => context, fields: () => ['prior'] };
  setup(t, {}, { registration: () => ({ contextManager: null, propagator: null }), beforeInitialize: () => {
    api.context.setGlobalContextManager(manager.enable()); api.propagation.setGlobalPropagator(propagator);
  } });
  assert.deepEqual(api.propagation.fields(), ['prior']);
  const key = api.createContextKey('prior-context');
  api.context.with(api.context.active().setValue(key, 7), () => assert.equal(api.context.active().getValue(key), 7));
});

test('explicit registration enables and uses caller context and propagator unchanged', async t => {
  const manager = new AsyncLocalStorageContextManager(); let enabled = 0;
  const enable = manager.enable.bind(manager); manager.enable = () => { enabled++; return enable(); };
  const propagator = { inject(_context, carrier, setter) { setter.set(carrier, 'explicit', 'yes'); }, extract: context => context, fields: () => ['explicit'] };
  setup(t, { OTEL_PROPAGATORS: 'none' }, { registration: () => ({ contextManager: manager, propagator }) });
  assert.equal(enabled, 1); assert.deepEqual(api.propagation.fields(), ['explicit']);
  const carrier = {}; api.propagation.inject(api.context.active(), carrier); assert.deepEqual(carrier, { explicit: 'yes' });
});

test('wrapper still owns processors and metrics remain cumulative with explicit forceFlush', async t => {
  let foreignProcessorUsed = false;
  const c = setup(t, {}, { tracer: config => ({ ...config, spanProcessors: [{ onStart() { foreignProcessorUsed = true; } }] }) });
  c.tracer.startSpan('owned-pipeline').end(); await c.provider.forceFlush();
  assert.equal(foreignProcessorUsed, false); assert.equal(c.batches.flat().length, 1);
  const reader = c.meterConfig.readers[0];
  assert.equal(reader._exportInterval, 2147483647);
  assert.equal(reader._exporter.selectAggregationTemporality(), AggregationTemporality.CUMULATIVE);
  const counter = api.metrics.getMeter('provider-tests').createCounter('cumulative-counter');
  counter.add(3); await c.meterProvider.forceFlush(); counter.add(2); await c.meterProvider.forceFlush();
  const values = c.metricBatches.flatMap(batch => batch.scopeMetrics.flatMap(scope => scope.metrics.flatMap(metric => metric.dataPoints.map(point => point.value))));
  assert.deepEqual(values, [3, 5]);
});


test('invalid sampler retains the parentbased always-on default', async t => {
  const c = setup(t, { OTEL_TRACES_SAMPLER: 'unknown' });
  assert.equal(c.tracer.startSpan('fallback-on').isRecording(), true);
  const unsampledParent = api.trace.setSpanContext(api.context.active(), {
    traceId: '12345678901234567890123456789012', spanId: '1234567890123456', traceFlags: 0,
  });
  assert.equal(c.tracer.startSpan('parent-off', {}, unsampledParent).isRecording(), false);
});

test('span-specific environment limits override generic environment limits', async t => {
  const c = setup(t, { OTEL_ATTRIBUTE_COUNT_LIMIT: '0', OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT: '1', OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT: '1', OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT: '3' });
  const span = c.tracer.startSpan('env-specific'); span.setAttribute('first', 'abcdef'); span.setAttribute('second', 'dropped'); span.end();
  await c.provider.forceFlush(); assert.deepEqual(c.batches.flat()[0].attributes, { first: 'abc' });
});
