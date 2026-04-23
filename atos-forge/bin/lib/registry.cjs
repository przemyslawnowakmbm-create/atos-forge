#!/usr/bin/env node
'use strict';

/**
 * registry.cjs — CLI handler for `forge-tools registry` commands.
 *
 * Subcommands:
 *   scan [--force] [--json]        Discover agents from all configured paths, rebuild catalog
 *   list [--json]                  List all discovered agents with source and capability tags
 *   show <id>                      Show agent details, expertise preview, usage stats
 *   match <cap1> [cap2...] [--json] Find agents matching named capabilities
 *
 * The catalog is stored at .forge/agents/catalog.json and is used by the
 * Forge factory to inject specialist expertise into agent system prompts.
 */

const path = require('path');
const os = require('os');
const { output, error, getForgeRoot } = require('./core.cjs');

// ============================================================
// Chalk — graceful fallback
// ============================================================

let chalk;
try {
  chalk = require('chalk');
} catch {
  const handler = {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'level') return 0;
      return new Proxy((...args) => args.join(''), handler);
    },
    apply(target, thisArg, args) { return args.join(''); },
  };
  chalk = new Proxy((...args) => args.join(''), handler);
}

// ============================================================
// Helpers
// ============================================================

function getRegistry() {
  return require(path.join(getForgeRoot(), 'forge-agents', 'agent-registry'));
}

function getConfig(cwd) {
  try {
    const { getAgentRegistry } = require(path.join(getForgeRoot(), 'forge-config', 'config'));
    return getAgentRegistry(cwd);
  } catch {
    return { enabled: true, scan_paths: [], max_body_chars: 1500, capability_map: {} };
  }
}

function pad(str, width) {
  const s = String(str || '');
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

function sourceLabel(sourceType) {
  switch (sourceType) {
    case 'claude_agents': return chalk.cyan('~/.claude/agents');
    case 'codex_agents':  return chalk.magenta('~/.agents');
    case 'forge_internal': return chalk.dim('forge-internal');
    case 'project_local': return chalk.green('.claude/agents');
    default:               return chalk.dim(sourceType || 'custom');
  }
}

function statusIcon(status) {
  switch (status) {
    case 'ok':   return chalk.green('✓');
    case 'warn': return chalk.yellow('⚠');
    case 'fail': return chalk.red('✗');
    default:     return chalk.dim('-');
  }
}

// ============================================================
// Commands
// ============================================================

/**
 * registry scan [--force] [--json]
 * Discover agents, rebuild catalog, display summary.
 */
function cmdScan(cwd, args, raw) {
  const registry = getRegistry();
  const config = getConfig(cwd);

  if (!config.enabled) {
    if (raw) {
      console.log(JSON.stringify({ skipped: true, reason: 'agent_registry.enabled is false' }));
    } else {
      console.log(chalk.yellow('Agent registry is disabled (agent_registry.enabled: false in config)'));
    }
    return;
  }

  const catalog = registry.scan(cwd, config);
  const summary = registry.getCatalogSummary(catalog);

  if (raw) {
    console.log(JSON.stringify({
      scanned: true,
      total: summary.total,
      general: summary.general,
      forge_internal: summary.forge_internal,
      capabilities: summary.capabilities,
      catalog_path: registry.getCatalogPath(cwd),
    }));
    return;
  }

  console.log('');
  console.log(chalk.bold.white('Agent Registry Scan Complete'));
  console.log(chalk.dim('─'.repeat(48)));
  console.log(`  ${chalk.green(summary.total)} agents discovered`);
  console.log(`  ${chalk.cyan(summary.general)} general coding specialists`);
  console.log(`  ${chalk.dim(summary.forge_internal)} forge-internal (excluded from matching)`);
  console.log(`  ${chalk.yellow(summary.capabilities)} capability mappings`);
  console.log(`  Catalog: ${chalk.dim(registry.getCatalogPath(cwd))}`);
  console.log('');

  // Show discovered general agents
  const general = catalog.agents.filter(a => a.source_type !== 'forge_internal');
  if (general.length > 0) {
    console.log(chalk.bold('  General Specialists:'));
    for (const a of general) {
      const tags = a.capability_tags.length > 0
        ? chalk.dim(' [' + a.capability_tags.slice(0, 4).join(', ') + ']')
        : '';
      console.log(`  ${statusIcon('ok')}  ${pad(a.id, 24)}${sourceLabel(a.source_type)}${tags}`);
    }
    console.log('');
  }
}

/**
 * registry list [--json]
 * List all discovered agents.
 */
function cmdList(cwd, args, raw) {
  const registry = getRegistry();
  const catalog = registry.loadCatalog(cwd);

  if (!catalog) {
    if (raw) {
      console.log(JSON.stringify({ error: 'No catalog found', hint: 'Run: forge-tools registry scan' }));
    } else {
      console.log(chalk.yellow('No agent catalog found. Run: forge-tools registry scan'));
    }
    return;
  }

  if (raw) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }

  const summary = registry.getCatalogSummary(catalog);
  const ageStr = summary.age_hours < 1
    ? 'just now'
    : summary.age_hours < 24
      ? `${summary.age_hours.toFixed(0)}h ago`
      : `${(summary.age_hours / 24).toFixed(0)}d ago`;

  console.log('');
  console.log(chalk.bold.white(`Agent Registry`) + chalk.dim(` — last scan: ${ageStr}`));
  console.log(chalk.dim('─'.repeat(72)));
  console.log(
    chalk.bold(pad('ID', 26)) +
    chalk.bold(pad('SOURCE', 18)) +
    chalk.bold(pad('USED', 6)) +
    chalk.bold('CAPABILITY TAGS')
  );
  console.log(chalk.dim('─'.repeat(72)));

  const general = catalog.agents.filter(a => a.source_type !== 'forge_internal');
  const internal = catalog.agents.filter(a => a.source_type === 'forge_internal');

  if (general.length > 0) {
    console.log(chalk.bold.white('  General Coding Specialists:'));
    for (const a of general) {
      const tags = a.capability_tags.length > 0 ? a.capability_tags.join(', ') : chalk.dim('—');
      const used = a.usage_count > 0 ? chalk.cyan(String(a.usage_count)) : chalk.dim('0');
      const sr = a.success_rate != null
        ? chalk.dim(` (${(a.success_rate * 100).toFixed(0)}% success)`)
        : '';
      console.log(
        '  ' + pad(a.id, 24) +
        pad(sourceLabel(a.source_type), 22) +
        pad(used, 6) +
        chalk.dim(truncate(tags, 36)) + sr
      );
    }
  }

  if (internal.length > 0) {
    console.log('');
    console.log(chalk.bold.white('  Forge-Internal Agents (excluded from matching):'));
    for (const a of internal) {
      console.log('  ' + chalk.dim(pad(a.id, 24)) + chalk.dim(sourceLabel(a.source_type)));
    }
  }

  console.log(chalk.dim('─'.repeat(72)));
  console.log(chalk.dim(`  ${summary.total} agents total · ${summary.capabilities} capability mappings`));
  console.log('');
}

/**
 * registry show <id>
 * Show agent details, expertise preview, and usage stats.
 */
function cmdShow(cwd, args, raw) {
  const agentId = args[0];
  if (!agentId) {
    if (raw) {
      console.log(JSON.stringify({ error: 'Agent ID required' }));
    } else {
      console.error('Usage: forge-tools registry show <agent-id>');
    }
    process.exit(1);
  }

  const registry = getRegistry();
  const catalog = registry.loadCatalog(cwd);

  if (!catalog) {
    if (raw) {
      console.log(JSON.stringify({ error: 'No catalog found' }));
    } else {
      console.log(chalk.yellow('No catalog found. Run: forge-tools registry scan'));
    }
    return;
  }

  const agent = catalog.agents.find(a => a.id === agentId);
  if (!agent) {
    if (raw) {
      console.log(JSON.stringify({ error: `Agent '${agentId}' not found`, available: catalog.agents.map(a => a.id) }));
    } else {
      console.error(`Agent '${agentId}' not found. Run: forge-tools registry list`);
    }
    process.exit(1);
  }

  if (raw) {
    console.log(JSON.stringify(agent, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold.white(`  ${agent.id}`));
  console.log(chalk.dim('─'.repeat(60)));
  console.log(`  ${chalk.bold('Description:')} ${agent.description}`);
  console.log(`  ${chalk.bold('Source:')}      ${sourceLabel(agent.source_type)}`);
  console.log(`  ${chalk.bold('Path:')}        ${chalk.dim(agent.source_path)}`);
  if (agent.tools && agent.tools.length > 0) {
    console.log(`  ${chalk.bold('Tools:')}       ${chalk.dim(agent.tools.join(', '))}`);
  }
  if (agent.capability_tags.length > 0) {
    console.log(`  ${chalk.bold('Capabilities:')} ${chalk.cyan(agent.capability_tags.join(', '))}`);
  }
  console.log('');
  console.log(`  ${chalk.bold('Usage:')}       ${agent.usage_count || 0} tasks`);
  if (agent.success_rate != null) {
    const pct = (agent.success_rate * 100).toFixed(0);
    const color = agent.success_rate >= 0.8 ? chalk.green : agent.success_rate >= 0.5 ? chalk.yellow : chalk.red;
    console.log(`  ${chalk.bold('Success rate:')} ${color(pct + '%')} (${agent.success_count || 0} success / ${agent.failure_count || 0} failure)`);
  }
  if (agent.last_used) {
    console.log(`  ${chalk.bold('Last used:')}   ${chalk.dim(agent.last_used)}`);
  }
  console.log('');
  if (agent.expertise) {
    console.log(`  ${chalk.bold('Expertise preview:')}`);
    console.log(chalk.dim('  ' + agent.expertise.substring(0, 600).replace(/\n/g, '\n  ')));
    if (agent.expertise.length > 600) {
      console.log(chalk.dim(`  ...and ${agent.expertise.length - 600} more chars`));
    }
  } else {
    console.log(`  ${chalk.dim('No expertise excerpt available (forge-internal agents not used for injection)')}`);
  }
  console.log('');
}

/**
 * registry match <cap1> [cap2...] [--json]
 * Find agents matching the named Forge capabilities.
 */
function cmdMatch(cwd, args, raw) {
  const capabilityArgs = args.filter(a => !a.startsWith('--'));
  if (capabilityArgs.length === 0) {
    if (raw) {
      console.log(JSON.stringify({ error: 'At least one capability name required' }));
    } else {
      console.error('Usage: forge-tools registry match <capability> [capability...]');
      console.error('Example capabilities: typescript, api_server, testing, security, docker');
    }
    process.exit(1);
  }

  const registry = getRegistry();
  const catalog = registry.loadCatalog(cwd);

  if (!catalog) {
    if (raw) {
      console.log(JSON.stringify({ error: 'No catalog found' }));
    } else {
      console.log(chalk.yellow('No catalog found. Run: forge-tools registry scan'));
    }
    return;
  }

  // Build synthetic capabilities object matching analyzeTask() format
  const capabilities = {};
  for (const cap of capabilityArgs) {
    capabilities[cap] = [{ capability: cap, confidence: 1.0 }];
  }

  const matched = registry.matchAgents(catalog, capabilities, 5);

  if (raw) {
    console.log(JSON.stringify(matched.map(m => ({
      id: m.id,
      description: m.description,
      score: m.score,
      reason: m.reason,
      expertise_length: m.expertise ? m.expertise.length : 0,
    })), null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold.white(`Agents matching: ${capabilityArgs.join(', ')}`));
  console.log(chalk.dim('─'.repeat(60)));

  if (matched.length === 0) {
    console.log(chalk.dim('  No matching agents found.'));
    console.log(chalk.dim(`  Available capabilities: ${Object.keys(catalog.capability_map || {}).join(', ')}`));
  } else {
    for (const m of matched) {
      console.log(`  ${statusIcon('ok')}  ${chalk.bold(pad(m.id, 24))} score: ${chalk.cyan(m.score.toFixed(2))}`);
      console.log(`       ${chalk.dim(m.description)}`);
      console.log(`       matched via: ${chalk.yellow(m.reason)}`);
      console.log('');
    }
  }
}

// ============================================================
// Router
// ============================================================

async function handleRegistry(cwd, args, raw) {
  const subcommand = args[0];
  const subArgs = args.slice(1);
  const jsonFlag = args.includes('--json');
  const effectiveRaw = raw || jsonFlag;

  switch (subcommand) {
    case 'scan':
      cmdScan(cwd, subArgs, effectiveRaw);
      break;
    case 'list':
      cmdList(cwd, subArgs, effectiveRaw);
      break;
    case 'show':
      cmdShow(cwd, subArgs, effectiveRaw);
      break;
    case 'match':
      cmdMatch(cwd, subArgs.filter(a => a !== '--json'), effectiveRaw);
      break;
    default:
      if (!subcommand || subcommand === 'help') {
        console.log([
          '',
          chalk.bold('forge-tools registry — Agent Registry Commands'),
          '',
          '  scan [--json]            Discover agents, rebuild catalog',
          '  list [--json]            List all discovered agents',
          '  show <id>                Show agent details + expertise preview',
          '  match <cap> [cap...] [--json]  Find agents for capabilities',
          '',
          chalk.dim('  Example capabilities: typescript, api_server, testing, security, docker, ci_cd'),
          '',
        ].join('\n'));
      } else {
        console.error(`Unknown registry subcommand: ${subcommand}`);
        console.error('Available: scan, list, show, match');
        process.exit(1);
      }
  }
}

module.exports = { handleRegistry };
