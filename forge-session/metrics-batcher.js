// @ts-check
'use strict';

/**
 * forge-session/metrics-batcher.js  (P5 / 4.3.2)
 *
 * Buffers metric snapshots in memory and flushes them to
 * `.forge/session/metrics.json` every 250 ms or on shutdown.
 *
 * Each call to `snapshotUnitMetrics()` does a full read-modify-write of the
 * metrics file, which is fine for a handful of records but becomes a
 * hot bottleneck once 10+ agents push metrics in parallel. The batcher
 * collapses N writes per tick into a single read-modify-write.
 */

const fs = require('fs');
const path = require('path');

const FLUSH_INTERVAL_MS = 250;
const _buffers = new Map();   // cwd → { items, timer }
let _drainPromise = null;

function metricsPath(cwd) { return path.join(cwd, '.forge', 'session', 'metrics.json'); }

function _loadFile(cwd) {
  const p = metricsPath(cwd);
  if (!fs.existsSync(p)) {
    return { version: 1, started_at: new Date().toISOString(), budget_ceiling_usd: null, units: [] };
  }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { version: 1, started_at: new Date().toISOString(), budget_ceiling_usd: null, units: [] }; }
}

function _saveFile(cwd, data) {
  const dir = path.dirname(metricsPath(cwd));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metricsPath(cwd), JSON.stringify(data, null, 2));
}

function _normalize(unitData) {
  return {
    type: unitData.type || 'unknown',
    id: unitData.id || 'unknown',
    model: unitData.model || 'unknown',
    started_at: unitData.started_at || Date.now(),
    finished_at: unitData.finished_at || Date.now(),
    tokens: unitData.tokens || { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 },
    cost_usd: unitData.cost_usd || 0,
    phase: unitData.phase || 'execution',
    tool_calls: unitData.tool_calls || 0,
  };
}

/**
 * Add a unit snapshot to the buffer. Returns immediately; the flush
 * happens on the next interval tick.
 */
function snapshot(cwd, unitData) {
  const key = String(cwd);
  let entry = _buffers.get(key);
  if (!entry) {
    entry = { items: [], timer: null };
    _buffers.set(key, entry);
  }
  entry.items.push(_normalize(unitData));
  if (!entry.timer) {
    entry.timer = setTimeout(() => flushOne(key), FLUSH_INTERVAL_MS);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  }
  return entry.items.length;
}

function flushOne(key) {
  const entry = _buffers.get(key);
  if (!entry) return;
  const items = entry.items;
  entry.items = [];
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  if (items.length === 0) return;
  try {
    const data = _loadFile(key);
    data.units.push(...items);
    _saveFile(key, data);
  } catch (err) {
    // Put items back on failure so we don't lose data.
    entry.items.unshift(...items);
    // Re-arm timer with a slightly longer wait.
    entry.timer = setTimeout(() => flushOne(key), FLUSH_INTERVAL_MS * 2);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
    if (process.env.FORGE_DEBUG) console.error(`metrics-batcher: ${err.message}`);
  }
}

/**
 * Drain all pending metric writes. Call on process exit.
 */
function drain() {
  if (_drainPromise) return _drainPromise;
  _drainPromise = new Promise((resolve) => {
    for (const key of _buffers.keys()) flushOne(key);
    _drainPromise = null;
    resolve();
  });
  return _drainPromise;
}

/**
 * Auto-register exit handlers so we don't lose buffered metrics on
 * normal shutdown. Idempotent.
 */
let _handlersInstalled = false;
function installExitHandlers() {
  if (_handlersInstalled) return;
  _handlersInstalled = true;
  process.on('beforeExit', () => { drain(); });
  process.on('SIGTERM', () => { drain(); process.exit(0); });
  process.on('SIGINT',  () => { drain(); process.exit(130); });
}

module.exports = {
  snapshot,
  flushOne,
  drain,
  installExitHandlers,
  FLUSH_INTERVAL_MS,
};
