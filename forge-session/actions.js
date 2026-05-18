// @ts-check
'use strict';

/**
 * forge-session/actions.js  (P7 / 4.4.6)
 *
 * Action-observation log. Every agent step records one structured JSONL line
 * to `.forge/actions/<phase>/<wave>/<agent>.jsonl`.
 *
 * Two record shapes:
 *
 *   action      — what the agent intends to do
 *     { ts, kind:'action', type, path?, payload?, agent, phase, wave }
 *
 *   observation — the immediate result of the previous action
 *     { ts, kind:'observation', type, exit?, duration_ms?, sha_before?, sha_after?, summary? }
 *
 * Together they form an `action → observation → action` chain that can be
 * replayed (`forge-tools.cjs actions replay`) or diffed across runtimes.
 *
 * Idempotent: appending to a JSONL file is naturally append-only; we only
 * `mkdir` on first write.
 */

const fs = require('fs');
const path = require('path');

let _redactor = null;
function _safe(v) {
  if (_redactor === null) {
    try { _redactor = require('./redactor'); }
    catch { _redactor = false; }
  }
  if (!_redactor) return v;
  try { return _redactor.redactValue(v).value; } catch { return v; }
}

function _enabled(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd);
    if (config.actions && config.actions.log && config.actions.log.enabled === false) return false;
  } catch { /* default on */ }
  return true;
}

function _baseDir(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd);
    if (config.actions && config.actions.log && typeof config.actions.log.dir === 'string') {
      return path.resolve(cwd, config.actions.log.dir);
    }
  } catch { /* default */ }
  return path.join(cwd, '.forge', 'actions');
}

function _safeSegment(s) {
  return String(s || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
}

function logPath(cwd, ctx) {
  const phase = _safeSegment(ctx && ctx.phase);
  const wave  = _safeSegment(ctx && ctx.wave);
  const agent = _safeSegment(ctx && ctx.agent);
  return path.join(_baseDir(cwd), phase, wave, `${agent}.jsonl`);
}

function _append(cwd, ctx, record) {
  if (!_enabled(cwd)) return null;
  const p = logPath(cwd, ctx);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(_safe(record));
  fs.appendFileSync(p, line + '\n');
  return p;
}

/**
 * Log an action.
 * ctx     = { phase, wave, agent }
 * action  = { type: 'edit'|'run'|'read'|'spawn'|..., path?, payload? }
 */
function logAction(cwd, ctx, action) {
  return _append(cwd, ctx, {
    ts: new Date().toISOString(),
    kind: 'action',
    type: action && action.type ? String(action.type) : 'unknown',
    path: action && action.path != null ? String(action.path) : undefined,
    payload: action && action.payload != null ? action.payload : undefined,
    agent: ctx && ctx.agent ? String(ctx.agent) : undefined,
    phase: ctx && ctx.phase ? String(ctx.phase) : undefined,
    wave: ctx && ctx.wave ? String(ctx.wave) : undefined,
  });
}

/**
 * Log an observation. `obs.exit` and `obs.duration_ms` are common; arbitrary
 * fields are passed through.
 */
function logObservation(cwd, ctx, obs) {
  return _append(cwd, ctx, {
    ts: new Date().toISOString(),
    kind: 'observation',
    type: obs && obs.type ? String(obs.type) : 'result',
    exit: obs && obs.exit != null ? obs.exit : undefined,
    duration_ms: obs && obs.duration_ms != null ? obs.duration_ms : undefined,
    sha_before: obs && obs.sha_before ? obs.sha_before : undefined,
    sha_after: obs && obs.sha_after ? obs.sha_after : undefined,
    summary: obs && obs.summary != null ? obs.summary : undefined,
  });
}

/**
 * Read back a single agent's action log (in order). Returns [] if missing.
 */
function readLog(cwd, ctx) {
  const p = logPath(cwd, ctx);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const l of lines) {
    try { out.push(JSON.parse(l)); }
    catch { /* skip malformed */ }
  }
  return out;
}

/**
 * Walk the action directory and return all logs grouped by agent.
 * Useful for `forge-tools.cjs actions replay`.
 */
function listAllLogs(cwd) {
  const base = _baseDir(cwd);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const phase of fs.readdirSync(base)) {
    const phasePath = path.join(base, phase);
    if (!fs.statSync(phasePath).isDirectory()) continue;
    for (const wave of fs.readdirSync(phasePath)) {
      const wavePath = path.join(phasePath, wave);
      if (!fs.statSync(wavePath).isDirectory()) continue;
      for (const agentFile of fs.readdirSync(wavePath)) {
        if (!agentFile.endsWith('.jsonl')) continue;
        const agent = agentFile.slice(0, -'.jsonl'.length);
        out.push({ phase, wave, agent, file: path.join(wavePath, agentFile) });
      }
    }
  }
  return out;
}

module.exports = { logAction, logObservation, readLog, listAllLogs, logPath };
