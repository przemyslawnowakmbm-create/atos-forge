// @ts-check
'use strict';

/**
 * forge-session/redactor.js
 *
 * Single redaction pass for sensitive-data scrubbing of ledger entries,
 * knowledge-base learnings, audit records, and action logs.
 *
 * Patterns are lifted from hooks/forge-guard.js (deny patterns) and expanded
 * to cover: AWS keys, JWTs, Anthropic/OpenAI/GitHub tokens, Slack tokens,
 * Stripe keys, PEM blocks, DB DSNs (mongodb/postgres/mysql/redis).
 *
 * Matches are replaced with «REDACTED:<sha256-prefix>» so two leaks of the
 * same secret produce the same token (so reviewers can detect duplicate
 * exposures) but the secret itself is irrecoverable.
 */

const crypto = require('crypto');

const SECRET_PATTERNS = [
  // Generic credential-shape KV pairs
  { name: 'apikey-kv',   re: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/ig },
  { name: 'secret-kv',   re: /(?:secret|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/ig },
  { name: 'token-kv',    re: /(?:token|bearer|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-\.]{20,}["']/ig },
  // AWS
  { name: 'aws-akid',    re: /\b(?:AKIA|ASIA|AGPA|AROA|AIDA)[A-Z0-9]{16}\b/g },
  { name: 'aws-secret',  re: /(?:aws_secret_access_key|aws_access_key_id)\s*[:=]\s*["']?[A-Za-z0-9/+=]{30,}["']?/ig },
  // GitHub
  { name: 'gh-pat',      re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  // OpenAI / Anthropic — anthropic first (more specific prefix sk-ant-)
  { name: 'anthropic',   re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
  { name: 'openai-sk',   re: /\bsk-(?!ant-)[A-Za-z0-9_\-]{20,}\b/g },
  // Slack
  { name: 'slack',       re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  // Google
  { name: 'gcp-key',     re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  // Stripe
  { name: 'stripe',      re: /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]{20,}\b/g },
  // JWTs (3-segment base64url)
  { name: 'jwt',         re: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g },
  // PEM private keys
  { name: 'pem',         re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/g },
  // DSNs (mongo/postgres/mysql/redis)
  { name: 'mongo-dsn',   re: /mongodb(?:\+srv)?:\/\/[^:@\s]+:[^@\s]+@[^\s"']+/g },
  { name: 'pg-dsn',      re: /postgres(?:ql)?:\/\/[^:@\s]+:[^@\s]+@[^\s"']+/g },
  { name: 'mysql-dsn',   re: /mysql:\/\/[^:@\s]+:[^@\s]+@[^\s"']+/g },
  { name: 'redis-dsn',   re: /rediss?:\/\/[^:@\s]*:[^@\s]+@[^\s"']+/g },
];

function shaPrefix(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function redactToken(category, match) {
  return `«REDACTED:${category}:${shaPrefix(match)}»`;
}

/**
 * Redact secrets from a string. Returns { text, matches: [{category, count}] }.
 *
 * Idempotent: rerunning on already-redacted text is a no-op (the placeholder
 * pattern contains no «REDACTED» substring matchers).
 */
function redact(input) {
  if (typeof input !== 'string' || input.length === 0) return { text: input, matches: [] };
  let text = input;
  const matches = [];
  for (const { name, re } of SECRET_PATTERNS) {
    let count = 0;
    text = text.replace(re, (m) => { count++; return redactToken(name, m); });
    if (count > 0) matches.push({ category: name, count });
  }
  return { text, matches };
}

/**
 * Apply redaction to any JSON-serializable value (string / array / object).
 * Walks nested structures and rewrites strings in place. Returns the redacted
 * value and the aggregate match counts.
 */
function redactValue(value) {
  const counts = new Map();
  function walk(v) {
    if (typeof v === 'string') {
      const { text, matches } = redact(v);
      for (const m of matches) counts.set(m.category, (counts.get(m.category) || 0) + m.count);
      return text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  }
  const out = walk(value);
  const matches = [...counts.entries()].map(([category, count]) => ({ category, count }));
  return { value: out, matches };
}

/**
 * Load redaction config from forge-config. Default ON.
 */
function isEnabled(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd);
    if (config.session && config.session.redaction && config.session.redaction.enabled === false) return false;
  } catch { /* default on */ }
  return true;
}

module.exports = { redact, redactValue, isEnabled, SECRET_PATTERNS };
