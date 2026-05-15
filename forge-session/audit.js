'use strict';

/**
 * forge-session/audit.js
 *
 * Append-only signed audit log at `.forge/audit/audit.jsonl`.
 *
 * Every state transition records one canonical JSON line carrying:
 *   { v, ts, actor, action, subject, prev_hash, hash, sig?, payload? }
 *
 * Hash chain: hash = sha256(prev_hash + canonical_json({...rec, hash:'', sig:''}))
 * Signature (optional): Ed25519 over `hash`, using the project identity key
 * (forge-session/identity.js). Verifier walks the chain end-to-end.
 *
 * Config flag: `audit.enabled` (default true).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;

function auditDir(cwd) { return path.join(cwd, '.forge', 'audit'); }
function auditPath(cwd) { return path.join(auditDir(cwd), 'audit.jsonl'); }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isEnabled(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd);
    if (config.audit && config.audit.enabled === false) return false;
  } catch { /* default on */ }
  return true;
}

/**
 * Stable JSON: keys sorted recursively; no whitespace.
 */
function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return 'null';
}

function readLastHash(cwd) {
  const file = auditPath(cwd);
  if (!fs.existsSync(file)) return '0'.repeat(64);
  try {
    const content = fs.readFileSync(file, 'utf8').trim();
    if (!content) return '0'.repeat(64);
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && typeof obj.hash === 'string') return obj.hash;
      } catch { /* keep walking */ }
    }
  } catch { /* fall through */ }
  return '0'.repeat(64);
}

function getActor(cwd) {
  try {
    const id = require('./identity');
    return id.actor(cwd);
  } catch { return 'anonymous'; }
}

function signHash(cwd, hashHex) {
  try {
    const id = require('./identity');
    return id.signHex(cwd, hashHex);
  } catch { return null; }
}

/**
 * Append one record to the audit log. Returns the written record.
 *
 * `record.action` is mandatory; `subject` and `payload` are optional. The
 * caller must not pass `hash`, `prev_hash`, or `sig` — those are computed.
 */
function append(cwd, record) {
  if (!isEnabled(cwd)) return null;
  if (!record || typeof record.action !== 'string') {
    throw new Error('audit.append: record.action is required');
  }
  ensureDir(auditDir(cwd));
  const ts = record.ts || new Date().toISOString();
  const actor = record.actor || getActor(cwd);
  const prevHash = readLastHash(cwd);
  const base = {
    v: SCHEMA_VERSION,
    ts,
    actor,
    action: record.action,
    subject: record.subject || null,
    payload: record.payload || null,
    prev_hash: prevHash,
  };
  // Redact payload strings if redaction is enabled
  try {
    const { redactValue, isEnabled: redactionOn } = require('./redactor');
    if (redactionOn(cwd) && base.payload) {
      base.payload = redactValue(base.payload).value;
    }
  } catch { /* redactor optional at boot */ }
  const hash = crypto.createHash('sha256').update(prevHash + canonical(base)).digest('hex');
  const sig = signHash(cwd, hash);
  const rec = { ...base, hash, ...(sig ? { sig } : {}) };
  fs.appendFileSync(auditPath(cwd), JSON.stringify(rec) + '\n');
  return rec;
}

/**
 * Tail the last N records.
 */
function tail(cwd, n = 20) {
  const file = auditPath(cwd);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  const slice = lines.slice(-Math.max(1, n));
  return slice.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Walk the chain and verify every hash. Returns { ok, errors:[{line, reason}] }.
 * If identity is configured and entries carry `sig`, signatures are verified.
 */
function verify(cwd) {
  const file = auditPath(cwd);
  if (!fs.existsSync(file)) return { ok: true, count: 0, errors: [] };
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const errors = [];
  let prevHash = '0'.repeat(64);
  let identity;
  try { identity = require('./identity'); } catch { /* no sig verify */ }
  let pubKeyPem = null;
  try { if (identity) pubKeyPem = identity.publicKeyPem(cwd); } catch {}
  for (let i = 0; i < lines.length; i++) {
    let rec;
    try { rec = JSON.parse(lines[i]); }
    catch (e) { errors.push({ line: i + 1, reason: 'invalid JSON: ' + e.message }); continue; }
    if (rec.prev_hash !== prevHash) {
      errors.push({ line: i + 1, reason: `prev_hash mismatch (have ${rec.prev_hash}, expected ${prevHash})` });
    }
    const { hash: _h, sig: _s, ...rest } = rec;
    const want = crypto.createHash('sha256').update(prevHash + canonical(rest)).digest('hex');
    if (want !== rec.hash) {
      errors.push({ line: i + 1, reason: `hash mismatch (have ${rec.hash}, expected ${want})` });
    }
    if (rec.sig && pubKeyPem) {
      try {
        const ok = crypto.verify(null,
          Buffer.from(rec.hash, 'hex'),
          pubKeyPem,
          Buffer.from(rec.sig, 'base64'));
        if (!ok) errors.push({ line: i + 1, reason: 'signature verification failed' });
      } catch (e) {
        errors.push({ line: i + 1, reason: 'signature verify error: ' + e.message });
      }
    }
    prevHash = rec.hash;
  }
  return { ok: errors.length === 0, count: lines.length, errors };
}

/**
 * Export the audit log to a portable JSON envelope with the chain head and tail.
 */
function exportLog(cwd) {
  const file = auditPath(cwd);
  if (!fs.existsSync(file)) return { count: 0, records: [] };
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const records = lines.map(l => JSON.parse(l));
  return {
    count: records.length,
    head: records.length ? records[0].hash : null,
    tail: records.length ? records[records.length - 1].hash : null,
    records,
  };
}

module.exports = { append, tail, verify, exportLog, isEnabled, auditPath, SCHEMA_VERSION };
