'use strict';

/**
 * tiktoken adapter (optional dependency).
 *
 * Uses the cl100k_base encoding which approximates Codex/OpenAI flows.
 * Falls back to a code-aware heuristic (3.2 c/t — tiktoken trends tighter
 * than Anthropic for code) when the dependency is missing.
 */

let _enc = null;
let _available = null;

function _load() {
  if (_available !== null) return _available;
  try {
    const tk = require('tiktoken');
    if (typeof tk.encoding_for_model === 'function') {
      // Prefer gpt-4 model encoding (cl100k_base); fall back to base.
      try { _enc = tk.encoding_for_model('gpt-4'); }
      catch { _enc = tk.get_encoding ? tk.get_encoding('cl100k_base') : null; }
    } else if (typeof tk.get_encoding === 'function') {
      _enc = tk.get_encoding('cl100k_base');
    }
    _available = !!_enc;
  } catch {
    _enc = null;
    _available = false;
  }
  return _available;
}

function _heuristic(text) {
  return Math.ceil((text || '').length / 3.2);
}

function estimateTokens(text, _opts = {}) {
  if (!_load()) return _heuristic(text);
  try {
    const out = _enc.encode(text || '');
    return out.length;
  } catch { /* fall through */ }
  return _heuristic(text);
}

function estimateBytes(byteLength) {
  return Math.ceil(byteLength / 3.2);
}

module.exports = {
  name: 'tiktoken',
  get available() { return _load(); },
  estimateTokens,
  estimateBytes,
};
