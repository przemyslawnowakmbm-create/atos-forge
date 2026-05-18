'use strict';

/**
 * forge-tools capabilities — list / describe / resolve / check
 *
 * Subcommands:
 *   list                                  List capability catalog
 *   describe <cap>                        Show a single capability definition
 *   resolve <cap1,cap2,...>               Resolve a comma-separated capability set
 *   check <file> [--plan path]            Check if a file write is allowed under
 *                                         the plan's declared capabilities (frontmatter)
 *   mode                                  Show current enforcement mode
 */

const fs = require('fs');
const path = require('path');

function loadCapabilities() {
  try {
    return require(path.join(path.dirname(__dirname), '..', '..', 'forge-agents', 'capabilities'));
  } catch (err) {
    console.error(`Failed to load capabilities module: ${err.message}`);
    process.exit(1);
  }
}

function parseFrontmatter(planPath) {
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan not found: ${planPath}`);
  }
  const raw = fs.readFileSync(planPath, 'utf8');
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) return {};
  const fm = m[1];
  // Look for capabilities: [a, b, c]  or list form
  const capLine = fm.match(/^capabilities:\s*\[(.+?)\]\s*$/m);
  if (capLine) {
    return { capabilities: capLine[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) };
  }
  const listMatch = fm.match(/^capabilities:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (listMatch) {
    const items = listMatch[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    return { capabilities: items };
  }
  return {};
}

async function handleCapabilities(cwd, args) {
  const caps = loadCapabilities();
  const sub = args[0];

  if (!sub || sub === 'list') {
    console.log('Capabilities catalog:\n');
    for (const [name, def] of Object.entries(caps.CAPABILITIES)) {
      console.log(`  ${name.padEnd(20)} tools=${def.tools.join(',')} egress=${def.egress}`);
    }
    return;
  }

  if (sub === 'describe') {
    const name = args[1];
    if (!name) { console.error('usage: capabilities describe <name>'); process.exit(2); }
    const def = caps.CAPABILITIES[name];
    if (!def) { console.error(`Unknown capability: ${name}`); process.exit(1); }
    console.log(JSON.stringify({ name, ...def }, null, 2));
    return;
  }

  if (sub === 'resolve') {
    const list = args[1];
    if (!list) { console.error('usage: capabilities resolve <cap1,cap2,...>'); process.exit(2); }
    const set = list.split(',').map(s => s.trim()).filter(Boolean);
    const resolved = caps.resolve(set);
    console.log(JSON.stringify(resolved, null, 2));
    return;
  }

  if (sub === 'check') {
    const target = args[1];
    if (!target) { console.error('usage: capabilities check <file> [--plan path]'); process.exit(2); }
    let planPath = null;
    for (let i = 2; i < args.length - 1; i++) {
      if (args[i] === '--plan') planPath = args[i + 1];
    }
    if (!planPath) {
      console.error('Provide --plan <path-to-plan.md>');
      process.exit(2);
    }
    const fm = parseFrontmatter(planPath);
    const declared = fm.capabilities || [];
    const resolved = caps.resolve(declared);
    const check = caps.isWriteAllowed(target, resolved.writePaths);
    console.log(JSON.stringify({
      file: target,
      declared,
      writePaths: resolved.writePaths,
      allowed: check.allowed,
      reason: check.reason || null,
    }, null, 2));
    if (!check.allowed) process.exit(1);
    return;
  }

  if (sub === 'mode') {
    const m = caps.mode(cwd);
    console.log(m);
    return;
  }

  console.error(`Unknown capabilities subcommand: ${sub}`);
  console.error('Subcommands: list | describe <cap> | resolve <c1,c2,...> | check <file> --plan <p> | mode');
  process.exit(2);
}

module.exports = { handleCapabilities };
