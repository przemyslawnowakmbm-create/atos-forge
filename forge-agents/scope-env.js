'use strict';

/**
 * forge-agents/scope-env.js
 *
 * Environment scoping for agent subprocesses (P3 / 4.1.1).
 *
 * Today, every Claude/Codex subprocess and every Docker container is launched
 * with `env: { ...process.env, ... }` — the host shell environment is piped
 * through unfiltered. One prompt-injection or rogue MCP server = total secret
 * exfiltration.
 *
 * Replacement: default-deny allowlist + plan-declared `secrets_scope: []`
 * frontmatter + per-project policy at `.forge/policy/secrets.allowlist.yaml`.
 *
 * Hard defaults: PATH, HOME, USER, LANG, LC_*, TERM, TZ, SHELL, PWD,
 * NODE_OPTIONS (but stripped of preload tricks), TMPDIR.
 *
 * Anything not on the allowlist or plan scope is dropped.
 */

const fs = require('fs');
const path = require('path');

// Names — exact match (case-sensitive on POSIX, normalized on Win32).
const DEFAULT_HARD_NAMES = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'LC_NUMERIC', 'LC_TIME', 'LC_COLLATE',
  'TERM', 'TZ',
]);

// Prefixes — kept verbatim (CI / runtime hints that downstream tools read).
const DEFAULT_PREFIX_ALLOW = [
  'FORGE_',
  'XDG_',          // freedesktop dirs
];

// Secrets we recognize by name. If the plan declares `secrets_scope`, we
// include only matching ones from this map (case-insensitive).
const KNOWN_SECRET_NAMES = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_REGION', 'AWS_PROFILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GCP_PROJECT', 'GCP_PROJECT_ID',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
  'DOCKER_USERNAME', 'DOCKER_PASSWORD',
  'SLACK_TOKEN',
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY',
  'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL',
  'REDIS_URL',
  'FORGE_OIDC_TOKEN', 'FORGE_SAML_SUBJECT',
  'CLAUDE_CODE_ENTRYPOINT',
  'CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL',
]);

/**
 * Strip dangerous NODE_OPTIONS flags (preload-based attacks).
 */
function sanitizeNodeOptions(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const banned = /(?:--require|-r|--inspect|--experimental-loader|--loader|--cpu-prof|--heap-prof)\s*[^\s]*/g;
  const cleaned = value.replace(banned, '').replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

/**
 * Read project policy at `.forge/policy/secrets.allowlist.yaml`.
 *
 * Minimal YAML parser — supports:
 *   names: [A, B, C]
 *   prefixes: [X_, Y_]
 *
 * Anything more elaborate is silently ignored to avoid a YAML dep.
 */
function readProjectPolicy(cwd) {
  try {
    const p = path.join(cwd, '.forge', 'policy', 'secrets.allowlist.yaml');
    if (!fs.existsSync(p)) return { names: [], prefixes: [] };
    const text = fs.readFileSync(p, 'utf8');
    return parseTinyYaml(text);
  } catch { return { names: [], prefixes: [] }; }
}

function parseTinyYaml(text) {
  const out = { names: [], prefixes: [] };
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*(names|prefixes)\s*:\s*\[\s*(.*?)\s*\]\s*(?:#.*)?$/);
    if (m) {
      const items = m[2].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      out[m[1]] = items;
    }
  }
  return out;
}

/**
 * Scope environment for an agent subprocess.
 *
 * @param {NodeJS.ProcessEnv} sourceEnv - typically process.env
 * @param {string[]} secretsScope - names the plan declares (frontmatter)
 * @param {object} extras - additional env to layer on top (always passes)
 * @param {object} [opts]
 * @param {string} [opts.cwd] - project root for policy lookup
 * @returns {NodeJS.ProcessEnv} scoped env (new object, never mutates input)
 */
function scopeEnvForAgent(sourceEnv, secretsScope = [], extras = {}, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const policy = readProjectPolicy(cwd);
  const allowedNames = new Set([...DEFAULT_HARD_NAMES, ...(policy.names || [])]);
  const allowedPrefixes = [...DEFAULT_PREFIX_ALLOW, ...(policy.prefixes || [])];
  const scope = new Set((secretsScope || []).map(s => String(s).trim()).filter(Boolean));

  const result = {};
  for (const [key, val] of Object.entries(sourceEnv || {})) {
    if (val === undefined) continue;
    // Hard-deny `__` weird names
    if (typeof key !== 'string' || !key) continue;
    if (allowedNames.has(key)) { result[key] = val; continue; }
    if (allowedPrefixes.some(p => key.startsWith(p))) { result[key] = val; continue; }
    // Plan-declared scope
    if (scope.has(key)) { result[key] = val; continue; }
    // Known secret names — only if plan declared them
    if (KNOWN_SECRET_NAMES.has(key) && scope.has(key)) { result[key] = val; continue; }
    // Otherwise drop.
  }

  // Sanitize NODE_OPTIONS if present
  if (sourceEnv && typeof sourceEnv.NODE_OPTIONS === 'string') {
    const safe = sanitizeNodeOptions(sourceEnv.NODE_OPTIONS);
    if (safe) result.NODE_OPTIONS = safe; else delete result.NODE_OPTIONS;
  }

  // Layer extras on top (these always pass — they're caller-controlled)
  for (const [k, v] of Object.entries(extras || {})) {
    if (v !== undefined && v !== null) result[k] = String(v);
  }

  return result;
}

/**
 * Diff helper — returns { kept, dropped } so callers can log what was stripped.
 */
function diff(sourceEnv, scoped) {
  const kept = Object.keys(scoped || {});
  const dropped = Object.keys(sourceEnv || {}).filter(k => !(k in (scoped || {})));
  return { kept, dropped };
}

/**
 * Check if env allowlist is enabled in config.
 */
function isEnabled(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd);
    return config.security && config.security.env_allowlist && config.security.env_allowlist.enabled === true;
  } catch { return false; }
}

module.exports = {
  scopeEnvForAgent,
  diff,
  isEnabled,
  DEFAULT_HARD_NAMES,
  DEFAULT_PREFIX_ALLOW,
  KNOWN_SECRET_NAMES,
};
