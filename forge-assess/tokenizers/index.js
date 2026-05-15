// @ts-check
'use strict';

/**
 * Tokenizer registry.
 *
 * Selection order:
 *   1. opts.tokenizer (explicit)
 *   2. config.assess.tokenizer  (heuristic | anthropic | tiktoken | auto)
 *   3. 'auto' → probe environment (claude provider → anthropic, codex → tiktoken)
 *   4. fallback → heuristic
 *
 * Every adapter exports { name, estimateTokens(text, opts), estimateBytes(bytes) }.
 */

const heuristic = require('./heuristic');
const anthropic = require('./anthropic');
const tiktoken = require('./tiktoken');

const ADAPTERS = { heuristic, anthropic, tiktoken };

function configFor(cwd) {
  try {
    const cfg = require('../../forge-config/config');
    const { config } = cfg.loadConfig(cwd || process.cwd());
    const t = config.assess && config.assess.tokenizer;
    if (typeof t === 'string') return t;
  } catch { /* ignore */ }
  return 'heuristic';
}

function detectProvider() {
  // Cheap heuristic — does NOT spawn a subprocess.
  try {
    if (process.env.FORGE_AGENT_PROVIDER === 'codex') return 'codex';
    if (process.env.FORGE_AGENT_PROVIDER === 'claude') return 'claude';
    if ((process.argv[1] || '').includes('/.codex/')) return 'codex';
    if ((process.argv[1] || '').includes('/.claude/')) return 'claude';
  } catch { /* ignore */ }
  return 'claude';
}

function resolveByName(name) {
  if (!name || name === 'auto') {
    const provider = detectProvider();
    if (provider === 'codex' && tiktoken.available) return tiktoken;
    if (anthropic.available) return anthropic;
    return heuristic;
  }
  const adapter = ADAPTERS[name];
  if (!adapter) return heuristic;
  // If an explicit adapter is requested but its native dep isn't there,
  // fall back to heuristic with a one-time warning channel (caller logs).
  if (adapter.available === false) return heuristic;
  return adapter;
}

let _cachedAdapter = null;
let _cachedKey = null;
function getTokenizer(cwd, opts = {}) {
  const explicit = opts.tokenizer || null;
  const name = explicit || configFor(cwd) || 'heuristic';
  const key = `${name}:${detectProvider()}`;
  if (_cachedAdapter && _cachedKey === key) return _cachedAdapter;
  _cachedAdapter = resolveByName(name);
  _cachedKey = key;
  return _cachedAdapter;
}

function estimateTokens(text, cwdOrOpts, maybeOpts) {
  // Two call shapes: estimateTokens(text)  and  estimateTokens(text, cwd, opts)
  let cwd = null, opts = {};
  if (typeof cwdOrOpts === 'string') { cwd = cwdOrOpts; opts = maybeOpts || {}; }
  else if (cwdOrOpts && typeof cwdOrOpts === 'object') { opts = cwdOrOpts; }
  return getTokenizer(cwd, opts).estimateTokens(text, opts);
}

function estimateBytes(byteLength, cwdOrOpts) {
  let cwd = null, opts = {};
  if (typeof cwdOrOpts === 'string') cwd = cwdOrOpts;
  else if (cwdOrOpts && typeof cwdOrOpts === 'object') opts = cwdOrOpts;
  return getTokenizer(cwd, opts).estimateBytes(byteLength);
}

function _resetCacheForTests() { _cachedAdapter = null; _cachedKey = null; }

module.exports = {
  ADAPTERS,
  getTokenizer,
  resolveByName,
  estimateTokens,
  estimateBytes,
  _resetCacheForTests,
};
