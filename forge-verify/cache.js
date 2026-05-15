// @ts-check
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// P5 / 4.3.4 — Verification cache
//
// Key = sha256(layer_id || file_hashes || config_hash).
//   • layer_id    — verify layer name (e.g. 'tests', 'tsc', 'dep').
//   • file_hashes — sha256 of each input file's content (cached in-memory).
//   • config_hash — sha256 of the relevant slice of .forge/config.json
//                   so changes to verify config invalidate keys safely.
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 120000; // 2 minutes — kept for back-compat
const _hashCache = new Map();  // absPath → { mtimeMs, size, sha }

function _verifyConfig(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd);
    const v = (config.verify && config.verify.cache) || {};
    return {
      enabled: v.enabled !== false,
      ttl_ms: typeof v.ttl_ms === 'number' ? v.ttl_ms : DEFAULT_TTL_MS,
      configHashSalt: _stableStringify(config.verify || {}),
    };
  } catch {
    return { enabled: true, ttl_ms: DEFAULT_TTL_MS, configHashSalt: '' };
  }
}

function _stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(_stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify(obj[k])).join(',') + '}';
}

function _fileHash(absPath) {
  try {
    const st = fs.statSync(absPath);
    const cached = _hashCache.get(absPath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return cached.sha;
    }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
    _hashCache.set(absPath, { mtimeMs: st.mtimeMs, size: st.size, sha });
    return sha;
  } catch {
    return 'missing';
  }
}

function cacheDir(cwd) { return path.join(cwd, '.forge', 'cache'); }

function cacheKey(layer, files, cwd) {
  const cfg = _verifyConfig(cwd);
  const hasher = crypto.createHash('sha256');
  hasher.update('layer:' + layer);
  hasher.update('\x00cfg:' + cfg.configHashSalt);
  for (const f of (files || []).slice().sort()) {
    const abs = path.resolve(cwd, f);
    hasher.update('\x00file:' + f + ':' + _fileHash(abs));
  }
  return hasher.digest('hex').slice(0, 16);
}

function get(layer, files, cwd) {
  try {
    const cfg = _verifyConfig(cwd);
    if (!cfg.enabled) return null;
    const key = cacheKey(layer, files, cwd);
    const cachePath = path.join(cacheDir(cwd), `${layer}-${key}.json`);
    if (!fs.existsSync(cachePath)) return null;
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (Date.now() - cached.timestamp > cfg.ttl_ms) return null;
    return cached.result;
  } catch { return null; }
}

function set(layer, files, cwd, result) {
  try {
    const cfg = _verifyConfig(cwd);
    if (!cfg.enabled) return;
    const dir = cacheDir(cwd);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const key = cacheKey(layer, files, cwd);
    fs.writeFileSync(
      path.join(dir, `${layer}-${key}.json`),
      JSON.stringify({ timestamp: Date.now(), key, layer, result })
    );
  } catch { /* silent */ }
}

function invalidate(cwd) {
  try {
    _hashCache.clear();
    const dir = cacheDir(cwd);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* silent */ }
}

function stats(cwd) {
  try {
    const dir = cacheDir(cwd);
    if (!fs.existsSync(dir)) return { entries: 0, bytes: 0 };
    let bytes = 0; let entries = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(dir, f);
      const s = fs.statSync(p);
      bytes += s.size;
      entries++;
    }
    return { entries, bytes };
  } catch { return { entries: 0, bytes: 0 }; }
}

module.exports = { get, set, invalidate, cacheKey, stats };
