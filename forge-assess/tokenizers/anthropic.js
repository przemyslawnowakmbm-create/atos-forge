'use strict';

/**
 * Anthropic tokenizer adapter (optional dependency).
 *
 * Tries to load `@anthropic-ai/tokenizer`. If unavailable, falls back to
 * a tighter code-aware heuristic (3.4 chars/token) and exposes
 * `available=false` so callers can degrade gracefully.
 */

let _tokenizer = null;
let _available = null;

function _load() {
  if (_available !== null) return _available;
  try {
    _tokenizer = require('@anthropic-ai/tokenizer');
    _available = !!_tokenizer && (typeof _tokenizer.countTokens === 'function' || typeof _tokenizer.encode === 'function');
  } catch {
    _tokenizer = null;
    _available = false;
  }
  return _available;
}

function _heuristic(text) {
  // Anthropic-flavoured ratio: code/structured content compresses ~3.4 c/t.
  return Math.ceil((text || '').length / 3.4);
}

function estimateTokens(text, _opts = {}) {
  if (!_load()) return _heuristic(text);
  try {
    if (typeof _tokenizer.countTokens === 'function') return _tokenizer.countTokens(text || '');
    if (typeof _tokenizer.encode === 'function') return _tokenizer.encode(text || '').length;
  } catch { /* fall through to heuristic */ }
  return _heuristic(text);
}

function estimateBytes(byteLength) {
  return Math.ceil(byteLength / 3.4);
}

module.exports = {
  name: 'anthropic',
  get available() { return _load(); },
  estimateTokens,
  estimateBytes,
};
