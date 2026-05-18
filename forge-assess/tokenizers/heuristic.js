// @ts-check
'use strict';

/**
 * Cheap character-based heuristic tokenizer.
 *
 * Default. Same behaviour as the legacy `chars/4` heuristic, kept for
 * back-compat. Code-heavy content is closer to 3.2–3.8 chars/token; if
 * accuracy matters use the anthropic or tiktoken adapter.
 */

const DEFAULT_RATIO = 4;

function estimateTokens(text, opts = {}) {
  const ratio = opts.charsPerToken || DEFAULT_RATIO;
  return Math.ceil((text || '').length / ratio);
}

function estimateBytes(byteLength, opts = {}) {
  const ratio = opts.charsPerToken || DEFAULT_RATIO;
  return Math.ceil(byteLength / ratio);
}

module.exports = {
  name: 'heuristic',
  estimateTokens,
  estimateBytes,
};
