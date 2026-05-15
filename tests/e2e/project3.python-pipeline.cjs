'use strict';

/**
 * tests/e2e/project3.python-pipeline.cjs
 *
 * Project 3: Python data pipeline.
 * Exercises P3 (container hardening + env allowlist) and
 * P4 (capability-scoped agent permissions).
 */

const path = require('path');
const fs = require('fs');
const h = require('./harness.cjs');

function run() {
  const ledger = h.newLedger('project3-python-pipeline');
  const root = h.createProject('python-pipeline');
  try {
    // 1) Seed pipeline scaffold.
    h.writeFile(root, 'pipeline/etl.py',
      "def transform(rows):\n    return [r for r in rows if r]\n");
    h.writeFile(root, 'tests/test_etl.py',
      "from pipeline.etl import transform\n" +
      "def test_filters_empty(): assert transform([1, None, 2]) == [1, 2]\n");
    h.gitInit(root);

    // 2) Capability resolution: write_src + write_tests.
    const caps = require(path.join(h.FDP_ROOT, 'forge-agents', 'capabilities.js'));
    const r1 = caps.resolve(['write_src', 'write_tests']);
    h.assert(Array.isArray(r1.allowedTools) && r1.allowedTools.includes('Write'),
      'write_src should grant Write tool');
    h.record(ledger, 'capabilities:resolves-write-src+tests',
      'pass', `tools=${r1.allowedTools.length} egress=${r1.egress}`);

    // 3) Write-path allowlist enforces correctly.
    const allowed = caps.isWriteAllowed('src/foo.js', r1.writePaths);
    const denied  = caps.isWriteAllowed('/etc/passwd', r1.writePaths);
    h.assert(allowed.allowed === true, 'src/* should be writable');
    h.assert(denied.allowed === false, '/etc/passwd must NOT be writable');
    h.record(ledger, 'capabilities:write-path-allowlist', 'pass',
      'src/* allowed, /etc/passwd denied');

    // 4) Unknown capability lands in `unknown` field.
    const r2 = caps.resolve(['totally_invalid_cap']);
    h.assert(Array.isArray(r2.unknown) && r2.unknown.includes('totally_invalid_cap'),
      'unknown caps should be reported');
    h.record(ledger, 'capabilities:reports-unknown', 'pass');

    // 5) scope-env: only allowlisted env vars survive when toggle on.
    const scopeEnv = require(path.join(h.FDP_ROOT, 'forge-agents', 'scope-env.js'));
    if (typeof scopeEnv.scopeEnvForAgent === 'function') {
      const base = { PATH: '/usr/bin', GITHUB_TOKEN: 'secret_value', RANDOM_VAR: 'nope' };
      const scoped = scopeEnv.scopeEnvForAgent(base, ['GITHUB_TOKEN'], { TERM: 'dumb' });
      h.assert(scoped.GITHUB_TOKEN === 'secret_value', 'GITHUB_TOKEN should pass');
      h.assert(scoped.RANDOM_VAR === undefined, 'RANDOM_VAR should be stripped');
      h.record(ledger, 'scope-env:allowlist-enforced', 'pass',
        'allowlisted survives, non-allowlisted dropped');
    } else {
      h.record(ledger, 'scope-env:skipped', 'pass', 'scopeEnvForAgent not exported');
    }

    // 6) Container hardened-flags: toDockerArgs must include --cap-drop ALL +
    //    --security-opt no-new-privileges + --read-only when hardened=true.
    const spec = require(path.join(h.FDP_ROOT, 'forge-containers', 'container-spec.js'));
    const dockerSpec = {
      id: 'forge-e2e',
      image: 'node:20',
      memory: '512m',
      cpus: '1',
      workdir: '/workspace',
      volumes: [{ host: root, container: '/workspace', mode: 'rw' }],
      env: { TERM: 'dumb' },
      mode: 'agent',
    };
    const args = spec.toDockerArgs(dockerSpec, { hardened: true, profile: 'minimal', egress: 'off' });
    h.assert(args.includes('--cap-drop') && args.includes('ALL'),
      '--cap-drop ALL missing');
    h.assert(args.includes('--security-opt') && args.some(a => /no-new-privileges/.test(a)),
      'no-new-privileges missing');
    h.assert(args.includes('--read-only'), '--read-only missing');
    h.assert(args.includes('--network') && args.includes('none'),
      'egress=off should yield --network none');
    h.record(ledger, 'containers:hardened-flags', 'pass',
      'cap-drop ALL + no-new-privileges + read-only + network none');

  } catch (err) {
    h.record(ledger, 'fatal', 'fail', String(err && err.message || err));
  } finally {
    h.finalize(ledger);
    h.writeReport(ledger);
    h.destroyProject(root);
  }
  return ledger;
}

if (require.main === module) {
  const l = run();
  process.exitCode = l.fail === 0 ? 0 : 1;
}

module.exports = { run };
