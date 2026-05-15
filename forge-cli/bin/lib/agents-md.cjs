'use strict';

/**
 * forge-cli/bin/lib/agents-md.cjs  (P7 / 4.5.1)
 *
 * Generate / check / diff AGENTS.md — the cross-runtime contract that
 * Codex, OpenHands, Cursor, Gemini, and Claude Code all read.
 *
 * Subcommands:
 *   agents-md generate [--root .] [--out AGENTS.md] [--check]
 *   agents-md check    [--root .]
 *   agents-md diff     [--root .]
 *
 * `check` is non-mutating: prints OK / DRIFTED. `diff` shows what would
 * change. `generate --check` is an alias for `check`.
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'agents.md.tmpl');
const END_MARKER = '## «END-GENERATED»';

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function listForgeModules(root) {
  const expected = [
    'forge-cli', 'forge-graph', 'forge-config', 'forge-session',
    'forge-verify', 'forge-assess', 'forge-agents', 'forge-containers',
    'forge-system', 'forge-analyze',
  ];
  const lines = [];
  for (const m of expected) {
    const present = fs.existsSync(path.join(root, m));
    if (present) {
      let summary = '';
      try {
        // Look for an obvious summary file.
        const readme = path.join(root, m, 'README.md');
        if (fs.existsSync(readme)) {
          const head = fs.readFileSync(readme, 'utf8').split('\n').filter(Boolean)[0] || '';
          summary = head.replace(/^#+\s*/, '').slice(0, 80);
        }
      } catch { /* ignore */ }
      lines.push(`- \`${m}/\`${summary ? ` — ${summary}` : ''}`);
    }
  }
  return lines.join('\n');
}

function formatNpmScripts(pkg) {
  if (!pkg || !pkg.scripts) return '_(no scripts defined)_';
  const rows = Object.keys(pkg.scripts).sort().map(k => {
    return `- \`npm run ${k}\` — \`${pkg.scripts[k]}\``;
  });
  return rows.join('\n');
}

function listForgeCapabilities(root) {
  // Best-effort: walk the forge modules and pull each module's exported
  // top-level functions from its `index.js` or main file. If the graph DB
  // is built we could query it, but that's a heavyweight dependency for
  // a generator; we keep it static.
  const modules = [
    { name: 'forge-graph', summary: 'code graph (deps, impact, cycles, hotspots, capabilities)' },
    { name: 'forge-verify', summary: '16-layer verification engine + auto-fix loop' },
    { name: 'forge-assess', summary: 'plan assessment + tokenizer adapters' },
    { name: 'forge-agents', summary: 'dynamic agent factory + capability resolver' },
    { name: 'forge-containers', summary: 'ephemeral container + worktree orchestration' },
    { name: 'forge-session', summary: 'ledger, audit log, identity, redactor, metrics, actions' },
    { name: 'forge-system', summary: 'multi-repo interface detection + system graph' },
    { name: 'forge-config', summary: 'unified config defaults + merge' },
    { name: 'forge-analyze', summary: 'repo / phase analysis helpers' },
    { name: 'forge-cli',    summary: 'CLI surface — `node forge-cli/bin/forge-tools.cjs <cmd>`' },
  ];
  const lines = [];
  for (const m of modules) {
    if (fs.existsSync(path.join(root, m.name))) {
      lines.push(`- **${m.name}** — ${m.summary}`);
    }
  }
  return lines.join('\n');
}

function getForgeVersion(root) {
  // Read this package's package.json. If we're inside an installed Forge
  // dist, the same lookup still works because we ship package.json.
  const pkg = readJson(path.join(root, 'package.json'));
  return pkg && pkg.name === 'forge-cli' ? pkg.version : 'embedded';
}

function buildContent(root) {
  const tmpl = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const pkg = readJson(path.join(root, 'package.json')) || {};
  const replacements = {
    PROJECT_NAME: pkg.name || path.basename(root),
    PROJECT_DESCRIPTION: pkg.description || '(no description)',
    PROJECT_LICENSE: pkg.license || 'UNLICENSED',
    PROJECT_VERSION: pkg.version || '0.0.0',
    NODE_ENGINES: (pkg.engines && pkg.engines.node) || '>=16.7.0',
    GENERATED_AT: new Date().toISOString(),
    FORGE_VERSION: getForgeVersion(root),
    MODULE_LAYOUT: listForgeModules(root) || '_(no forge modules present)_',
    NPM_SCRIPTS: formatNpmScripts(pkg),
    FORGE_CAPABILITIES: listForgeCapabilities(root) || '_(none detected)_',
  };
  let out = tmpl;
  for (const [k, v] of Object.entries(replacements)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  return out;
}

function readExisting(outPath) {
  if (!fs.existsSync(outPath)) return null;
  return fs.readFileSync(outPath, 'utf8');
}

// Stable comparison: strip the GENERATED_AT line so check/diff don't flap
// purely because the timestamp got bumped a few ms later.
function stableForCompare(s) {
  if (!s) return '';
  return s.replace(/^>\s*\*\*Generated:\*\*\s.*$/gmi, '> **Generated:** <ts>');
}

function splitAroundMarker(content) {
  if (!content) return { generated: '', tail: '' };
  const idx = content.indexOf(END_MARKER);
  if (idx === -1) return { generated: content, tail: '' };
  const generated = content.slice(0, idx);
  const tail = content.slice(idx);
  return { generated, tail };
}

function preserveTail(newContent, oldContent) {
  if (!oldContent) return newContent;
  const oldSplit = splitAroundMarker(oldContent);
  const newSplit = splitAroundMarker(newContent);
  if (!oldSplit.tail) return newContent;
  // Replace the *new* tail with the *old* tail to preserve hand edits.
  return newSplit.generated + oldSplit.tail;
}

function generate(root, opts) {
  const out = opts && opts.out ? path.resolve(root, opts.out) : path.join(root, 'AGENTS.md');
  const next = buildContent(root);
  const existing = readExisting(out);
  const merged = preserveTail(next, existing);
  if (opts && opts.check) {
    if (existing == null) return { ok: false, reason: 'missing', out };
    if (stableForCompare(existing).trim() === stableForCompare(merged).trim()) {
      return { ok: true, out };
    }
    return { ok: false, reason: 'drift', out };
  }
  fs.writeFileSync(out, merged);
  return { ok: true, out, bytes: Buffer.byteLength(merged, 'utf8') };
}

function diff(root, opts) {
  const out = opts && opts.out ? path.resolve(root, opts.out) : path.join(root, 'AGENTS.md');
  const next = buildContent(root);
  const existing = readExisting(out);
  const merged = preserveTail(next, existing);
  if (existing == null) {
    return { ok: false, reason: 'missing', diff: merged, out };
  }
  if (stableForCompare(existing).trim() === stableForCompare(merged).trim()) {
    return { ok: true, reason: 'identical', diff: '', out };
  }
  // Cheap line-diff.
  const a = existing.split('\n');
  const b = merged.split('\n');
  const lines = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) lines.push(`- ${a[i]}`);
      if (b[i] !== undefined) lines.push(`+ ${b[i]}`);
    }
  }
  return { ok: false, reason: 'drift', diff: lines.join('\n'), out };
}

function check(root) {
  return generate(root, { check: true });
}

function handleCli(argv) {
  // forge-tools.cjs agents-md <subcommand> [...flags]
  const sub = argv[0] || 'generate';
  // Locate --root <path>.
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx !== -1 ? path.resolve(argv[rootIdx + 1]) : process.cwd();
  const outIdx = argv.indexOf('--out');
  const out = outIdx !== -1 ? argv[outIdx + 1] : null;
  const checkFlag = argv.includes('--check');
  let res;
  if (sub === 'generate') res = generate(root, { out, check: checkFlag });
  else if (sub === 'check') res = check(root);
  else if (sub === 'diff')  res = diff(root, { out });
  else {
    process.stderr.write(`agents-md: unknown subcommand '${sub}'.\n`);
    process.exit(2);
  }
  if (sub === 'diff') {
    if (res.reason === 'identical') {
      process.stdout.write('AGENTS.md: identical\n');
    } else if (res.reason === 'missing') {
      process.stdout.write('AGENTS.md: missing (no existing file)\n');
      process.stdout.write(res.diff.split('\n').slice(0, 80).map(l => `+ ${l}`).join('\n') + '\n');
    } else {
      process.stdout.write(`AGENTS.md drift in ${res.out}\n`);
      process.stdout.write(res.diff + '\n');
    }
    process.exit(res.ok ? 0 : 1);
  }
  if (sub === 'check') {
    if (res.ok) { process.stdout.write(`AGENTS.md: OK (${res.out})\n`); process.exit(0); }
    process.stdout.write(`AGENTS.md: ${res.reason.toUpperCase()} (${res.out})\n`);
    process.exit(1);
  }
  // generate
  if (res.ok) {
    if (checkFlag) { process.stdout.write(`AGENTS.md: OK (${res.out})\n`); process.exit(0); }
    process.stdout.write(`AGENTS.md: wrote ${res.bytes} bytes → ${res.out}\n`);
    process.exit(0);
  }
  process.stdout.write(`AGENTS.md: ${res.reason} (${res.out})\n`);
  process.exit(1);
}

module.exports = { generate, check, diff, buildContent, handleCli };
