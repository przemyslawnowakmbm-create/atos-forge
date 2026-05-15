'use strict';

/**
 * tests/e2e/harness.cjs
 *
 * Shared harness for the Forge end-to-end project simulations.
 *
 * Each simulated project lives in its own scratch directory and exercises a
 * vertical slice of Forge functionality. The harness provides:
 *
 *   - `withProject(name, fn)` — create a scratch repo, set HOME, run `fn`,
 *     collect per-step timings, capture stdout/stderr.
 *   - `runForge(args)`        — shell-out to forge-tools.cjs with the project
 *                               cwd already bound.
 *   - `runNode(file, args)`   — execute a Node script under the project cwd.
 *   - `assert(cond, msg)`     — log + throw on failure (keeps assertions
 *                               visible in the HTML report).
 *   - `record(step, status)`  — push a step into the per-project ledger.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const FDP_ROOT = path.resolve(__dirname, '..', '..');
const FORGE_TOOLS = path.join(FDP_ROOT, 'forge-cli', 'bin', 'forge-tools.cjs');
const REPORT_DIR = path.join(FDP_ROOT, 'tests', 'e2e', 'reports');

function _ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createProject(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `forge-e2e-${name}-`));
  // Bare repo scaffold.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name,
    version: '0.0.1',
    description: `forge e2e simulated project: ${name}`,
    license: 'UNLICENSED',
    engines: { node: '>=16.7.0' },
    scripts: { test: 'echo "(no tests configured)"' },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'README.md'), `# ${name}\n\nSimulated Forge e2e project.\n`);
  fs.mkdirSync(path.join(root, '.forge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.forge', 'config.json'), JSON.stringify({
    log: { level: 'info', json: false },
    actions: { log: { enabled: true, dir: '.forge/actions' } },
  }, null, 2));
  // Action log dir for P7 simulation.
  fs.mkdirSync(path.join(root, '.forge', 'actions'), { recursive: true });
  // Session ledger so P8 resource read can return something.
  fs.mkdirSync(path.join(root, '.forge', 'session'), { recursive: true });
  fs.writeFileSync(path.join(root, '.forge', 'session', 'ledger.md'),
    `# Ledger — ${name}\n\nProject created at ${new Date().toISOString()}.\n`);
  return root;
}

function destroyProject(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); }
  catch { /* ignore */ }
}

function runForge(cwd, args, opts) {
  const all = [FORGE_TOOLS].concat(args);
  return _runNode(cwd, all, opts);
}

function runNode(cwd, file, args, opts) {
  const abs = path.isAbsolute(file) ? file : path.join(FDP_ROOT, file);
  return _runNode(cwd, [abs].concat(args || []), opts);
}

function _runNode(cwd, scriptArgs, opts) {
  const env = { ...process.env, ...(opts && opts.env ? opts.env : {}) };
  const res = spawnSync(process.execPath, scriptArgs, {
    cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    input: opts && opts.input ? opts.input : undefined,
    timeout: (opts && opts.timeout) || 30000,
  });
  return {
    code: res.status == null ? -1 : res.status,
    signal: res.signal || null,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function gitInit(root) {
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['config', 'user.email', 'e2e@forge.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name',  'Forge E2E'],       { cwd: root });
  execFileSync('git', ['add', '-A'],          { cwd: root });
  execFileSync('git', ['commit', '-m', 'init', '--quiet', '--no-verify'], { cwd: root });
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  _ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, content);
  return abs;
}

function readFile(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg || 'assertion failed');
    err._isAssert = true;
    throw err;
  }
}

function newLedger(name) {
  return {
    name,
    started_at: new Date().toISOString(),
    finished_at: null,
    pass: 0,
    fail: 0,
    steps: [],
  };
}

function record(ledger, step, status, detail, stdout, stderr) {
  const ok = status === 'pass';
  if (ok) ledger.pass++; else ledger.fail++;
  ledger.steps.push({
    name: step,
    status,
    detail: detail || '',
    stdout: stdout || '',
    stderr: stderr || '',
    ts: new Date().toISOString(),
  });
}

function finalize(ledger) {
  ledger.finished_at = new Date().toISOString();
  return ledger;
}

function writeReport(ledger) {
  _ensureDir(REPORT_DIR);
  const file = path.join(REPORT_DIR, `${ledger.name}.json`);
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2));
  return file;
}

function reportsDir() { return REPORT_DIR; }

module.exports = {
  FDP_ROOT,
  createProject,
  destroyProject,
  runForge,
  runNode,
  gitInit,
  writeFile,
  readFile,
  exists,
  assert,
  newLedger,
  record,
  finalize,
  writeReport,
  reportsDir,
};
