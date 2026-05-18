'use strict';

/**
 * forge-agents/capabilities.js
 *
 * Capability-scoped agent permissions (P4 / 4.2.3 — RBAC-lite).
 *
 * A plan declares `capabilities: [...]` in frontmatter. This module translates
 * that declaration into:
 *   - Claude Code `--allowedTools` and `--disallowedTools` flags.
 *   - Egress proxy profile selection (consumed by orchestrator).
 *   - A path policy (writes allowed under X, denied under Y).
 *   - A secrets_scope hint (used by scope-env.js).
 *
 * Capability semantics — kept deliberately small. Plans that don't declare
 * capabilities fall back to the legacy "all tools" behaviour when
 * `security.capabilities.enforce` is `warn` (default v1).
 */

const path = require('path');

/**
 * Canonical capability catalog.
 * tools:        Claude tool names allowed for this capability
 * write_paths:  globs that writes are allowed under
 * read_paths:   globs that reads are allowed under (informational; reads stay open)
 * egress:       proxy profile  ('strict' | 'build' | 'research' | 'off')
 * secrets:      secret env names this capability legitimately needs
 */
const CAPABILITIES = {
  read_src: {
    tools: ['Read', 'Glob', 'Grep'],
    write_paths: [],
    read_paths: ['**'],
    egress: 'off',
    secrets: [],
  },
  read_docs: {
    tools: ['Read', 'Glob', 'Grep'],
    write_paths: [],
    read_paths: ['docs/**', 'README*', '*.md', '.planning/**'],
    egress: 'off',
    secrets: [],
  },
  write_src: {
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    write_paths: ['src/**', 'lib/**', 'forge-*/**', '!**/node_modules/**'],
    read_paths: ['**'],
    egress: 'off',
    secrets: [],
  },
  write_docs: {
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
    write_paths: ['docs/**', 'README*', '*.md', '.planning/**'],
    read_paths: ['**'],
    egress: 'off',
    secrets: [],
  },
  write_tests: {
    tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    write_paths: ['tests/**', '**/*.test.*', '**/*.spec.*', '__tests__/**'],
    read_paths: ['**'],
    egress: 'off',
    secrets: [],
  },
  run_tests: {
    tools: ['Bash', 'Read', 'Glob', 'Grep'],
    write_paths: [],
    read_paths: ['**'],
    egress: 'off',
    secrets: ['CI'],
  },
  run_build: {
    tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    write_paths: ['build/**', 'dist/**', '.cache/**', 'node_modules/**'],
    read_paths: ['**'],
    egress: 'build',
    secrets: [],
  },
  network_npm: {
    tools: ['Bash', 'Read', 'Glob'],
    write_paths: ['node_modules/**', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
    read_paths: ['**'],
    egress: 'build',
    secrets: ['NPM_TOKEN'],
  },
  network_research: {
    tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
    write_paths: [],
    read_paths: ['**'],
    egress: 'research',
    secrets: [],
  },
  llm_call: {
    tools: ['Bash', 'Read', 'Glob', 'Grep'],
    write_paths: [],
    read_paths: ['**'],
    egress: 'strict',
    secrets: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
  },
  git_local: {
    tools: ['Bash', 'Read', 'Glob', 'Grep'],
    write_paths: ['.git/**'],
    read_paths: ['**'],
    egress: 'off',
    secrets: [],
  },
  git_remote: {
    tools: ['Bash', 'Read', 'Glob', 'Grep'],
    write_paths: ['.git/**'],
    read_paths: ['**'],
    egress: 'strict',
    secrets: ['GITHUB_TOKEN', 'GH_TOKEN'],
  },
};

const FALLBACK_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];

/**
 * Resolve a set of capabilities into the materialised policy.
 *
 * @param {string[]} caps
 * @returns {{
 *   allowedTools: string[],
 *   disallowedTools: string[],
 *   writePaths: string[],
 *   readPaths: string[],
 *   egress: 'off'|'strict'|'build'|'research',
 *   secretsScope: string[],
 *   unknown: string[],
 * }}
 */
function resolve(caps) {
  const declared = Array.isArray(caps) ? caps : [];
  const tools = new Set();
  const writePaths = new Set();
  const readPaths = new Set();
  const secrets = new Set();
  const egressLevels = new Set();
  const unknown = [];

  for (const c of declared) {
    const def = CAPABILITIES[c];
    if (!def) { unknown.push(c); continue; }
    for (const t of def.tools) tools.add(t);
    for (const p of def.write_paths) writePaths.add(p);
    for (const p of def.read_paths) readPaths.add(p);
    for (const s of def.secrets) secrets.add(s);
    egressLevels.add(def.egress);
  }

  // Pick widest egress: research > build > strict > off.
  const order = ['off', 'strict', 'build', 'research'];
  let chosenEgress = 'off';
  for (const lvl of egressLevels) {
    if (order.indexOf(lvl) > order.indexOf(chosenEgress)) chosenEgress = lvl;
  }

  const all = [...tools];
  const disallowed = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch']
    .filter(t => !tools.has(t));

  return {
    allowedTools: all.length > 0 ? all : FALLBACK_TOOLS.slice(),
    disallowedTools: all.length > 0 ? disallowed : [],
    writePaths: [...writePaths],
    readPaths: [...readPaths],
    egress: chosenEgress,
    secretsScope: [...secrets],
    unknown,
  };
}

/**
 * Check if a write to `targetPath` is allowed under `writePaths` globs.
 * Returns { allowed, reason }.
 *
 * Glob semantics — minimal:
 *   **       — any number of path segments
 *   *        — any number of chars in a segment
 *   !prefix  — exclusion (prefix matches reject the path)
 *   literal  — exact prefix match
 */
function isWriteAllowed(targetPath, writePaths) {
  if (!Array.isArray(writePaths) || writePaths.length === 0) {
    return { allowed: false, reason: 'no write capability declared' };
  }
  const norm = String(targetPath).replace(/^\.?\/+/, '');

  // First pass: exclusions
  for (const pattern of writePaths) {
    if (pattern.startsWith('!')) {
      const exclude = globToRegex(pattern.slice(1));
      if (exclude.test(norm)) return { allowed: false, reason: `excluded by ${pattern}` };
    }
  }
  // Second pass: inclusions
  for (const pattern of writePaths) {
    if (pattern.startsWith('!')) continue;
    if (globToRegex(pattern).test(norm)) return { allowed: true };
  }
  return { allowed: false, reason: 'no matching write_path glob' };
}

function globToRegex(glob) {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // ** — any depth, including zero segments
      re += '.*';
      i += 2;
      if (glob[i] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '.') {
      re += '\\.';
      i++;
    } else if ('+()|^$[]{}\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

/**
 * Enforcement mode from config: 'off' | 'warn' | 'enforce'.
 */
function mode(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd);
    const m = config.security && config.security.capabilities && config.security.capabilities.enforce;
    if (m === true) return 'enforce';
    if (m === 'warn') return 'warn';
    if (m === 'enforce') return 'enforce';
    return 'off';
  } catch { return 'off'; }
}

module.exports = {
  CAPABILITIES,
  resolve,
  isWriteAllowed,
  globToRegex,
  mode,
};
