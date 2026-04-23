#!/usr/bin/env node
'use strict';

/**
 * Agent Registry — discovers, catalogs, and matches specialized agent definitions.
 *
 * Scans ~/.claude/agents/, .claude/agents/ (project-local), and any configured
 * extra paths for Claude Code subagent .md files, then:
 *   - Parses their frontmatter + body
 *   - Extracts declarative expertise (checklists, patterns, rules — not procedural steps)
 *   - Computes capability tags by matching agent descriptions against Forge capability names
 *   - Builds a catalog at .forge/agents/catalog.json
 *   - Provides matchAgents() for factory.js to pick relevant experts per task
 *   - Tracks usage stats so Forge learns which agents help which capabilities
 *
 * General coding agents (typescript-pro, api-designer, etc.) are injected into
 * factory-built system prompts as "Specialist Expertise" sections.
 *
 * Forge-internal agents (forge-executor, forge-planner, etc.) are tagged
 * source_type: "forge_internal" and excluded from capability matching —
 * they serve a different purpose (Claude Code's Agent tool orchestration).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ============================================================
// Constants
// ============================================================

const CATALOG_FILE = 'catalog.json';
const CATALOG_DIR = path.join('.forge', 'agents');
const CATALOG_VERSION = '1';

// Minimum capability confidence to consider for matching
const MATCH_CONFIDENCE_MIN = 0.3;

// Forge-internal agent name prefixes — excluded from capability matching
const FORGE_INTERNAL_PREFIXES = ['forge-'];

// Built-in scan paths (checked in order, skipped if not present)
function getBuiltInScanPaths(cwd) {
  return [
    path.join(os.homedir(), '.claude', 'agents'),   // Claude Code global agents
    path.join(cwd, '.claude', 'agents'),             // Project-local agents
  ];
}

// Keyword sets for each Forge capability — matched against agent name+description
const CAPABILITY_DETECTION_KEYWORDS = {
  typescript:       ['typescript', ' ts '],
  javascript:       ['javascript', 'node.js', 'nodejs', 'es2023', 'es6', 'ecmascript'],
  react_advanced:   ['react', 'jsx', 'tsx', 'hooks', 'next.js', 'nextjs'],
  ui_components:    ['ui component', 'frontend interface', 'design system', 'css', 'tailwind'],
  state_management: ['state management', 'redux', 'zustand', 'mobx'],
  api_server:       ['api architect', 'rest api', 'rest and', 'api design', 'endpoint', 'fastapi', 'express'],
  graphql:          ['graphql'],
  testing:          ['test automation', 'test framework', 'testing', 'test engineer'],
  security:         ['security assessments', 'security audit', 'vulnerability', 'compliance', 'owasp'],
  docker:           ['docker', 'container', 'dockerfile', 'build system'],
  ci_cd:            ['ci/cd', 'ci cd', 'build pipeline', 'pipeline', 'github actions', 'jenkins'],
  kubernetes:       ['kubernetes', 'k8s', 'helm'],
  database_sql:     ['package management', 'dependency manager', 'dependency management'],
  message_queue:    ['message queue', 'kafka', 'rabbitmq'],
  caching:          ['cach', 'redis', 'memcached'],
  authentication:   ['authentication', 'jwt', 'oauth', 'session management'],
  payment:          ['payment', 'stripe', 'billing'],
  websocket:        ['websocket', 'realtime', 'real-time'],
};

// ============================================================
// Frontmatter Parser
// ============================================================

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Only handles the simple key: value format used in agent files.
 *
 * @param {string} content — full file content
 * @returns {{ frontmatter: object, body: string }}
 */
function parseFrontmatter(content) {
  const frontmatter = {};
  let body = content;

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter, body };

  const rawFm = match[1];
  body = match[2] || '';

  for (const line of rawFm.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.substring(0, colon).trim();
    const value = line.substring(colon + 1).trim();
    if (!key) continue;
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// ============================================================
// Declarative Content Extraction
// ============================================================

/**
 * Extract declarative knowledge from an agent body, skipping procedural scaffolding.
 *
 * Skipped:
 *   - Opening "You are a..." intro paragraph (first paragraph)
 *   - "When invoked:" numbered list
 *   - XML/HTML structural tags (<role>, <step>, <execution_flow>, etc.)
 *   - Bash code blocks inside procedural steps
 *
 * Kept:
 *   - Checklists (- item)
 *   - Section headers (## Title)
 *   - Patterns and rules
 *   - Code examples related to domain knowledge
 *
 * @param {string} body — raw agent body (after frontmatter)
 * @param {number} maxChars — truncation limit
 * @returns {string}
 */
function extractDeclarativeContent(body, maxChars) {
  if (!body) return '';

  const lines = body.split('\n');
  const kept = [];

  // State machine with 4 states:
  //   'pre'           — skipping leading blanks + optional intro paragraph
  //   'in_intro'      — inside a "You are a..." paragraph (skip until blank)
  //   'skip_invoked'  — inside "When invoked:" numbered list (skip until non-numbered)
  //   'content'       — collecting declarative knowledge
  let state = 'pre';

  for (const line of lines) {
    const trimmed = line.trim();

    // Always skip XML/HTML structural tags (used by forge-internal agents)
    if (/^<\/?[a-z_][\w-]*[\s/>]/.test(trimmed) || /^<\/?[a-z_][\w-]*>$/.test(trimmed)) {
      continue;
    }

    if (state === 'pre') {
      // Skip leading blank lines silently
      if (trimmed.length === 0) continue;

      // Check if this is an intro identity sentence
      const isIntroLine =
        /^you are (a |an )/i.test(trimmed) ||
        /^you are (an expert|a senior|a specialist)/i.test(trimmed);

      if (isIntroLine) {
        state = 'in_intro';
        continue; // skip this line, wait for blank to end intro
      }

      // Non-blank, non-intro first line → start collecting immediately
      state = 'content';
      // Fall through to collect below
    }

    if (state === 'in_intro') {
      // Skip all lines until blank line (end of intro paragraph)
      if (trimmed.length === 0) {
        state = 'pre'; // allow another blank pass / "When invoked:" detection
      }
      continue;
    }

    // In 'pre' after intro: handle "When invoked:" and further blank lines
    if (state === 'pre') {
      if (trimmed.length === 0) continue;

      if (/^when invoked[:\s]/i.test(trimmed)) {
        state = 'skip_invoked';
        continue;
      }

      // Non-blank content that isn't "When invoked:" → start collecting
      state = 'content';
      // Fall through
    }

    if (state === 'skip_invoked') {
      if (/^\d+[.)]\s/.test(trimmed)) continue; // numbered step — skip
      if (trimmed.length === 0) continue;        // blank within section — skip
      // Non-numbered, non-blank → end of invoked section, start collecting
      state = 'content';
      // Fall through to collect this line
    }

    // Detect "When invoked:" even during content (rare edge case: second invoked block)
    if (state === 'content' && /^when invoked[:\s]/i.test(trimmed)) {
      state = 'skip_invoked';
      continue;
    }

    if (state === 'content') {
      kept.push(line);
    }
  }

  // Remove leading blank lines
  while (kept.length > 0 && kept[0].trim() === '') kept.shift();
  // Remove trailing blank lines
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

  const text = kept.join('\n').trim();
  if (!maxChars || text.length <= maxChars) return text;

  // Truncate gracefully at section boundary if possible
  const sub = text.substring(0, maxChars);
  const lastSection = sub.lastIndexOf('\n##');
  if (lastSection > maxChars * 0.4) {
    return sub.substring(0, lastSection).trim() + '\n[...truncated]';
  }
  const lastBullet = sub.lastIndexOf('\n- ');
  if (lastBullet > maxChars * 0.5) {
    return sub.substring(0, lastBullet).trim() + '\n[...truncated]';
  }
  return sub.trim() + '\n[...truncated]';
}

// ============================================================
// Agent File Parser
// ============================================================

/**
 * Determine the source type for an agent based on its file path and name.
 *
 * @param {string} filePath
 * @param {string} agentName
 * @returns {'forge_internal' | 'claude_agents' | 'project_local' | 'custom'}
 */
function getSourceType(filePath, agentName) {
  // Forge-internal agents: prefix "forge-"
  if (FORGE_INTERNAL_PREFIXES.some(p => agentName.startsWith(p))) {
    return 'forge_internal';
  }
  const normalized = filePath.replace(/\\/g, '/');
  // Global Claude Code agents: in the user's home directory ~/.claude/agents/
  const homeClaude = path.join(os.homedir(), '.claude', 'agents').replace(/\\/g, '/');
  if (normalized.startsWith(homeClaude + '/')) return 'claude_agents';
  // Project-local Claude agents: .claude/agents/ inside any project directory
  if (normalized.includes('/.claude/agents/')) return 'project_local';
  if (normalized.includes('/.agents/')) return 'codex_agents';
  return 'custom';
}

/**
 * Compute capability tags for an agent from its name and description.
 *
 * @param {{ name: string, description: string }} agent
 * @returns {string[]} — list of Forge capability names
 */
function computeCapabilityTags(agent) {
  const text = `${agent.name} ${agent.description}`.toLowerCase();
  const tags = [];
  for (const [cap, keywords] of Object.entries(CAPABILITY_DETECTION_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      tags.push(cap);
    }
  }
  return tags;
}

/**
 * Parse a single agent .md file into a catalog entry.
 *
 * @param {string} filePath — absolute path to agent .md file
 * @param {number} maxBodyChars — max chars to store in expertise field
 * @returns {object | null}
 */
function parseAgentFile(filePath, maxBodyChars = 1500) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);

    const name = frontmatter.name || path.basename(filePath, '.md');
    const description = frontmatter.description || '';
    const tools = frontmatter.tools
      ? frontmatter.tools.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    const color = frontmatter.color || null;
    const sourceType = getSourceType(filePath, name);

    // Extract declarative expertise from body
    const expertise = extractDeclarativeContent(body, maxBodyChars);

    // Compute capability tags (only for non-forge-internal)
    const capabilityTags = sourceType !== 'forge_internal'
      ? computeCapabilityTags({ name, description })
      : [];

    return {
      id: name,
      name,
      description,
      tools,
      color,
      source_path: filePath,
      source_type: sourceType,
      capability_tags: capabilityTags,
      expertise,
      usage_count: 0,
      success_count: 0,
      failure_count: 0,
      success_rate: null,
      last_used: null,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Discovery
// ============================================================

/**
 * Scan a directory for agent .md files.
 *
 * @param {string} dir — directory to scan
 * @param {number} maxBodyChars
 * @returns {object[]} — parsed agents
 */
function scanDirectory(dir, maxBodyChars) {
  if (!fs.existsSync(dir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const agents = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = path.join(dir, entry);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
    } catch { continue; }
    const agent = parseAgentFile(filePath, maxBodyChars);
    if (agent) agents.push(agent);
  }
  return agents;
}

/**
 * Discover all agents from all configured scan paths.
 * Deduplicates by agent ID (first-seen wins).
 *
 * @param {string} cwd
 * @param {object} config — agent_registry config section
 * @returns {object[]}
 */
function discoverAgents(cwd, config = {}) {
  const maxBodyChars = config.max_body_chars || 1500;
  const extraPaths = Array.isArray(config.scan_paths) ? config.scan_paths : [];

  const searchPaths = [
    ...getBuiltInScanPaths(cwd),
    ...extraPaths.map(p => p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p),
  ];

  const seenIds = new Set();
  const agents = [];

  for (const dir of searchPaths) {
    const found = scanDirectory(dir, maxBodyChars);
    for (const agent of found) {
      if (seenIds.has(agent.id)) continue; // first-seen wins
      seenIds.add(agent.id);
      agents.push(agent);
    }
  }

  return agents;
}

// ============================================================
// Capability Map Builder
// ============================================================

/**
 * Build a reverse map: capability → [agentId, ...].
 * Only includes non-forge-internal agents.
 * Merges with any user-provided overrides from config.
 *
 * @param {object[]} agents
 * @param {object} overrides — from config.agent_registry.capability_map
 * @returns {object}
 */
function buildCapabilityMap(agents, overrides = {}) {
  const map = {};

  for (const agent of agents) {
    if (agent.source_type === 'forge_internal') continue;
    for (const cap of agent.capability_tags) {
      if (!map[cap]) map[cap] = [];
      if (!map[cap].includes(agent.id)) {
        map[cap].push(agent.id);
      }
    }
  }

  // Apply user overrides (merge, not replace)
  for (const [cap, ids] of Object.entries(overrides)) {
    if (!Array.isArray(ids)) continue;
    if (!map[cap]) map[cap] = [];
    for (const id of ids) {
      if (!map[cap].includes(id)) map[cap].push(id);
    }
  }

  return map;
}

// ============================================================
// Catalog I/O
// ============================================================

function getCatalogPath(cwd) {
  return path.join(cwd, CATALOG_DIR, CATALOG_FILE);
}

/**
 * Load the agent catalog from disk.
 *
 * @param {string} cwd
 * @returns {object | null} — catalog or null if not found/invalid
 */
function loadCatalog(cwd) {
  try {
    const content = fs.readFileSync(getCatalogPath(cwd), 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save the agent catalog to disk.
 *
 * @param {string} cwd
 * @param {object} catalog
 */
function saveCatalog(cwd, catalog) {
  const dir = path.join(cwd, CATALOG_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCatalogPath(cwd), JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}

/**
 * Compute a hash of the catalog for cache invalidation.
 * Uses the catalog file's mtime — cheap and sufficient.
 *
 * @param {string} cwd
 * @returns {string} — mtime as string, or 'none' if catalog missing
 */
function getCatalogHash(cwd) {
  try {
    const stat = fs.statSync(getCatalogPath(cwd));
    return stat.mtimeMs.toString();
  } catch {
    return 'none';
  }
}

// ============================================================
// Scan (main entry point for discovery)
// ============================================================

/**
 * Scan all configured paths, build a fresh catalog, save it, and return it.
 *
 * @param {string} cwd — project root
 * @param {object} config — agent_registry config section
 * @returns {object} — the saved catalog
 */
function scan(cwd, config = {}) {
  const agents = discoverAgents(cwd, config);
  const capabilityOverrides = config.capability_map || {};
  const capabilityMap = buildCapabilityMap(agents, capabilityOverrides);

  // Preserve usage stats from existing catalog
  const existing = loadCatalog(cwd);
  if (existing && existing.agents) {
    const existingById = {};
    for (const a of existing.agents) existingById[a.id] = a;
    for (const agent of agents) {
      const prev = existingById[agent.id];
      if (prev) {
        agent.usage_count = prev.usage_count || 0;
        agent.success_count = prev.success_count || 0;
        agent.failure_count = prev.failure_count || 0;
        agent.success_rate = prev.success_rate || null;
        agent.last_used = prev.last_used || null;
      }
    }
  }

  const catalog = {
    version: CATALOG_VERSION,
    last_scan: new Date().toISOString(),
    agents,
    capability_map: capabilityMap,
  };

  saveCatalog(cwd, catalog);
  return catalog;
}

// ============================================================
// Matching
// ============================================================

/**
 * Find the best matching agents for a given set of task capabilities.
 * Only returns agents with expertise content to inject.
 * Never returns forge-internal agents.
 *
 * @param {object | null} catalog — from loadCatalog()
 * @param {object} capabilities — from analyzeTask(): { moduleName: [{capability, confidence}] }
 * @param {number} maxAgents — max to return (default 2)
 * @returns {{ id, description, expertise, score, reason }[]} sorted descending by score
 */
function matchAgents(catalog, capabilities, maxAgents = 2) {
  if (!catalog || !catalog.agents || !catalog.capability_map) return [];

  // Flatten capability list with confidence
  const flatCaps = [];
  for (const caps of Object.values(capabilities)) {
    if (!Array.isArray(caps)) continue;
    for (const c of caps) {
      if (typeof c.capability === 'string' && (c.confidence || 0) >= MATCH_CONFIDENCE_MIN) {
        flatCaps.push({ cap: c.capability, confidence: c.confidence });
      }
    }
  }

  if (flatCaps.length === 0) return [];

  // Score each agent based on matched capabilities
  const scores = {};
  const reasons = {};

  for (const { cap, confidence } of flatCaps) {
    const agentIds = catalog.capability_map[cap] || [];
    for (const id of agentIds) {
      scores[id] = (scores[id] || 0) + confidence;
      if (!reasons[id]) reasons[id] = [];
      reasons[id].push(`${cap} (${(confidence * 100).toFixed(0)}%)`);
    }
  }

  // Sort by score, filter agents without expertise or that are forge-internal
  const agentById = {};
  for (const a of catalog.agents) agentById[a.id] = a;

  const sortedIds = Object.keys(scores)
    .filter(id => {
      const agent = agentById[id];
      return agent && agent.source_type !== 'forge_internal' && agent.expertise;
    })
    .sort((a, b) => scores[b] - scores[a]);

  return sortedIds
    .slice(0, maxAgents)
    .map(id => {
      const agent = agentById[id];
      return {
        id,
        description: agent.description,
        expertise: agent.expertise,
        score: scores[id],
        reason: reasons[id].join(', '),
      };
    });
}

// ============================================================
// Usage Tracking
// ============================================================

/**
 * Record that an agent was used for a task.
 * Updates usage_count, success/failure counts, success_rate, last_used in catalog.
 *
 * @param {string} cwd
 * @param {string[]} agentIds — agent IDs used
 * @param {'success' | 'failure' | 'unknown'} outcome
 */
function recordUsage(cwd, agentIds, outcome = 'unknown') {
  if (!agentIds || agentIds.length === 0) return;
  try {
    const catalog = loadCatalog(cwd);
    if (!catalog) return;

    const now = new Date().toISOString();
    let changed = false;

    for (const agent of catalog.agents) {
      if (!agentIds.includes(agent.id)) continue;
      agent.usage_count = (agent.usage_count || 0) + 1;
      agent.last_used = now;
      if (outcome === 'success') {
        agent.success_count = (agent.success_count || 0) + 1;
      } else if (outcome === 'failure') {
        agent.failure_count = (agent.failure_count || 0) + 1;
      }
      const total = (agent.success_count || 0) + (agent.failure_count || 0);
      agent.success_rate = total > 0
        ? Math.round(((agent.success_count || 0) / total) * 100) / 100
        : null;
      changed = true;
    }

    if (changed) saveCatalog(cwd, catalog);
  } catch {
    // Fire-and-forget — usage tracking must not break execution
  }
}

// ============================================================
// Catalog Summary (for CLI display)
// ============================================================

/**
 * Return a human-readable summary of the catalog.
 *
 * @param {object} catalog
 * @returns {{ total, general, forge_internal, capabilities, age_hours }}
 */
function getCatalogSummary(catalog) {
  if (!catalog) return null;
  const total = catalog.agents.length;
  const general = catalog.agents.filter(a => a.source_type !== 'forge_internal').length;
  const forge_internal = total - general;
  const capabilities = Object.keys(catalog.capability_map || {}).length;
  const age_hours = catalog.last_scan
    ? (Date.now() - new Date(catalog.last_scan).getTime()) / (1000 * 60 * 60)
    : Infinity;
  return { total, general, forge_internal, capabilities, age_hours };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  // Core lifecycle
  scan,
  loadCatalog,
  saveCatalog,
  getCatalogPath,
  getCatalogHash,

  // Matching (used by factory.js)
  matchAgents,

  // Usage tracking (called after task completion)
  recordUsage,

  // Parsing utilities (for testing + CLI)
  parseAgentFile,
  parseFrontmatter,
  extractDeclarativeContent,
  computeCapabilityTags,
  discoverAgents,
  buildCapabilityMap,
  getCatalogSummary,

  // Constants (exported for config defaults and tests)
  CAPABILITY_DETECTION_KEYWORDS,
  FORGE_INTERNAL_PREFIXES,
  MATCH_CONFIDENCE_MIN,
};
