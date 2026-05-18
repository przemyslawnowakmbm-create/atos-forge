// @ts-check
'use strict';

/**
 * forge-session/otel.js  (P6 / 4.4.4)
 *
 * Optional OpenTelemetry exporter. Lazy-imports the OTLP HTTP exporter only
 * when the user has configured `telemetry.otel.endpoint`. The OTEL packages
 * are *optional* dependencies — Forge runs identically when they are absent;
 * only the corresponding feature is unavailable.
 *
 * Public API (degrades to no-ops if OTEL is unavailable):
 *
 *   init(cwd)              — read config, install global tracer if endpoint set.
 *   startSpan(name, attrs) — returns a span object with `end({attrs?})`.
 *   wrap(name, attrs, fn)  — wraps `fn` in a span; returns fn's value.
 *
 * Span attributes are scrubbed via the redactor before being added — the OTEL
 * collector never sees raw strings from user prompts.
 */

const VERSION = '1';

let _state = {
  inited: false,
  enabled: false,
  endpoint: '',
  tracer: null,
  provider: null,
};

function _otelConfig(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd || process.cwd());
    const t = (config.telemetry && config.telemetry.otel) || {};
    return {
      endpoint: typeof t.endpoint === 'string' ? t.endpoint : '',
      serviceName: typeof t.service_name === 'string' ? t.service_name : 'forge',
      headers: typeof t.headers === 'object' && t.headers ? t.headers : {},
    };
  } catch { return { endpoint: '', serviceName: 'forge', headers: {} }; }
}

function _redactAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return attrs;
  try {
    const r = require('./redactor');
    return r.redactValue(attrs).value;
  } catch { return attrs; }
}

/**
 * Initialize the OTEL pipeline. Idempotent.
 * Returns true if telemetry is active, false otherwise.
 */
function init(cwd) {
  if (_state.inited) return _state.enabled;
  _state.inited = true;
  const cfg = _otelConfig(cwd);
  if (!cfg.endpoint) return false;
  let api, sdkTrace, exporter, resourceMod;
  try {
    // OTEL packages are optional — load via dynamic require so the type
    // checker doesn't insist on them being installed at check time.
    /* eslint-disable global-require */
    const dynReq = /** @type {(id: string) => any} */ (require);
    api = dynReq('@opentelemetry/api');
    sdkTrace = dynReq('@opentelemetry/sdk-trace-node');
    exporter = dynReq('@opentelemetry/exporter-trace-otlp-http');
    resourceMod = dynReq('@opentelemetry/resources');
    /* eslint-enable global-require */
  } catch {
    // Optional deps missing — silently fall back to no-op.
    return false;
  }
  try {
    const otlp = new exporter.OTLPTraceExporter({ url: cfg.endpoint, headers: cfg.headers });
    const provider = new sdkTrace.NodeTracerProvider({
      resource: new resourceMod.Resource({
        'service.name': cfg.serviceName,
        'forge.version': VERSION,
      }),
    });
    provider.addSpanProcessor(new sdkTrace.BatchSpanProcessor(otlp));
    provider.register();
    _state.provider = provider;
    _state.tracer = api.trace.getTracer('forge');
    _state.enabled = true;
    _state.endpoint = cfg.endpoint;
  } catch {
    _state.enabled = false;
  }
  return _state.enabled;
}

function startSpan(name, attrs) {
  if (!_state.enabled || !_state.tracer) {
    return { end: () => {}, addAttr: () => {}, setStatus: () => {} };
  }
  const span = _state.tracer.startSpan(String(name || 'forge.span'));
  const safe = _redactAttrs(attrs);
  if (safe) {
    for (const k of Object.keys(safe)) {
      try { span.setAttribute(k, typeof safe[k] === 'object' ? JSON.stringify(safe[k]) : safe[k]); }
      catch { /* ignore */ }
    }
  }
  return {
    end: (extra) => {
      const safeExtra = _redactAttrs(extra);
      if (safeExtra) {
        for (const k of Object.keys(safeExtra)) {
          try { span.setAttribute(k, typeof safeExtra[k] === 'object' ? JSON.stringify(safeExtra[k]) : safeExtra[k]); }
          catch { /* ignore */ }
        }
      }
      try { span.end(); } catch { /* ignore */ }
    },
    addAttr: (k, v) => { try { span.setAttribute(k, v); } catch { /* ignore */ } },
    setStatus: (code, message) => { try { span.setStatus({ code, message }); } catch { /* ignore */ } },
  };
}

/**
 * Wrap `fn` in a span. If `fn` returns a Promise, the span is closed when it
 * resolves/rejects. If `fn` throws synchronously, the span captures the error.
 */
function wrap(name, attrs, fn) {
  const span = startSpan(name, attrs);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        (v) => { span.end(); return v; },
        (e) => { span.end({ 'error.message': e && e.message ? String(e.message) : String(e) }); throw e; }
      );
    }
    span.end();
    return r;
  } catch (e) {
    span.end({ 'error.message': e && e.message ? String(e.message) : String(e) });
    throw e;
  }
}

function isEnabled() { return _state.enabled; }

function shutdown() {
  if (_state.provider && typeof _state.provider.shutdown === 'function') {
    try { return _state.provider.shutdown(); } catch { /* ignore */ }
  }
  return Promise.resolve();
}

module.exports = { init, startSpan, wrap, isEnabled, shutdown };
