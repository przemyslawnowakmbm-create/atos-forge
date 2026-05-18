// @ts-check
'use strict';

/**
 * forge-cli/lib/logger.js  (P6 / 4.4.3)
 *
 * Lightweight in-repo structured logger with secret redaction.
 *
 * Levels: debug | info | warn | error  (priority 10 / 20 / 30 / 40).
 * Mode:
 *   FORGE_LOG_JSON=1                 — emit JSON lines on stderr.
 *   FORGE_LOG_LEVEL=debug|info|...   — minimum level.
 *   config: { log: { level, json } } — read once via forge-config.loadConfig.
 *
 * Output channel: stderr for warn/error, stdout for info/debug, exactly as the
 * existing `console.*` callsites do today, so we are a drop-in replacement.
 *
 * Redaction: every payload string + nested object is run through
 * `forge-session/redactor.js` before serialization. This is mandatory (no
 * opt-out); the cost is ~one regex scan per record.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

let _cachedMinLevel = null;
let _cachedJson = null;
let _redactor = null;
let _cachedRedactionEnabled = null;

function _redact() {
  if (_redactor === null) {
    try { _redactor = require('../../forge-session/redactor'); }
    catch { _redactor = false; }
  }
  return _redactor;
}

function _redactionEnabled() {
  if (_cachedRedactionEnabled === null) {
    try {
      const r = _redact();
      if (!r) { _cachedRedactionEnabled = false; return false; }
      _cachedRedactionEnabled = r.isEnabled(process.cwd());
    } catch { _cachedRedactionEnabled = false; }
  }
  return _cachedRedactionEnabled;
}

function _scrub(value) {
  const r = _redact();
  if (!r || !_redactionEnabled()) return value;
  try { return r.redactValue(value).value; } catch { return value; }
}

function _readConfig() {
  if (_cachedMinLevel !== null && _cachedJson !== null) return;
  let cfgLevel = 'info';
  let cfgJson = false;
  try {
    const cfg = require('../../forge-config/config');
    const { config } = cfg.loadConfig(process.cwd());
    if (config.log) {
      if (typeof config.log.level === 'string') cfgLevel = config.log.level;
      if (typeof config.log.json === 'boolean') cfgJson = config.log.json;
    }
  } catch { /* defaults */ }
  // Env overrides.
  const envLvl = process.env.FORGE_LOG_LEVEL;
  if (envLvl && LEVELS[envLvl] !== undefined) cfgLevel = envLvl;
  if (process.env.FORGE_LOG_JSON === '1') cfgJson = true;
  if (process.env.FORGE_LOG_JSON === '0') cfgJson = false;
  _cachedMinLevel = LEVELS[cfgLevel] !== undefined ? LEVELS[cfgLevel] : LEVELS.info;
  _cachedJson = cfgJson;
}

/**
 * Reset cached configuration. Useful for tests; rarely needed at runtime.
 */
function reset() {
  _cachedMinLevel = null;
  _cachedJson = null;
  _cachedRedactionEnabled = null;
}

function _emit(level, msg, fields) {
  _readConfig();
  if (LEVELS[level] < _cachedMinLevel) return;
  const safeMsg = typeof msg === 'string' ? _scrub(msg) : msg;
  const safeFields = fields && typeof fields === 'object' ? _scrub(fields) : undefined;
  const stream = (level === 'warn' || level === 'error') ? process.stderr : process.stdout;
  if (_cachedJson) {
    const record = {
      ts: new Date().toISOString(),
      level,
      msg: typeof safeMsg === 'string' ? safeMsg : JSON.stringify(safeMsg),
    };
    if (safeFields) {
      for (const k of Object.keys(safeFields)) {
        if (record[k] === undefined) record[k] = safeFields[k];
      }
    }
    stream.write(JSON.stringify(record) + '\n');
    return;
  }
  // Pretty mode: `[LEVEL] message {field=val …}`
  let line = `[${level.toUpperCase()}] ${safeMsg}`;
  if (safeFields) {
    const parts = [];
    for (const k of Object.keys(safeFields)) {
      const v = safeFields[k];
      parts.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
    if (parts.length > 0) line += ` ${parts.join(' ')}`;
  }
  stream.write(line + '\n');
}

function debug(msg, fields) { _emit('debug', msg, fields); }
function info(msg, fields)  { _emit('info',  msg, fields); }
function warn(msg, fields)  { _emit('warn',  msg, fields); }
function error(msg, fields) { _emit('error', msg, fields); }

/**
 * Return a child logger that prepends `prefix` to every message and merges
 * `baseFields` into every payload. Useful for module-scoped loggers.
 */
function child(prefix, baseFields = {}) {
  return {
    debug: (m, f) => debug(`${prefix} ${m}`, { ...baseFields, ...(f || {}) }),
    info:  (m, f) => info (`${prefix} ${m}`, { ...baseFields, ...(f || {}) }),
    warn:  (m, f) => warn (`${prefix} ${m}`, { ...baseFields, ...(f || {}) }),
    error: (m, f) => error(`${prefix} ${m}`, { ...baseFields, ...(f || {}) }),
  };
}

module.exports = { debug, info, warn, error, child, reset, LEVELS };
