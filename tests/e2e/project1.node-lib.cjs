'use strict';

/**
 * tests/e2e/project1.node-lib.cjs
 *
 * Project 1: Minimal Node library.
 * Exercises P1 (safe exec / shell elimination), P6 (logger + SBOM).
 */

const path = require('path');
const fs = require('fs');
const h = require('./harness.cjs');

function run() {
  const ledger = h.newLedger('project1-node-lib');
  const root = h.createProject('node-lib');
  try {
    // 1) Seed a tiny lib + lockfile so SBOM has something to read.
    h.writeFile(root, 'src/index.js',
      "'use strict';\nfunction add(a, b) { return a + b; }\nmodule.exports = { add };\n");
    h.writeFile(root, 'package-lock.json', JSON.stringify({
      name: 'node-lib',
      version: '0.0.1',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'node-lib', version: '0.0.1' },
        'node_modules/lodash': {
          version: '4.17.21',
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          integrity: 'sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==',
          license: 'MIT',
        },
      },
    }, null, 2));
    h.gitInit(root);

    // 2) Run SBOM generator scoped to the test project.
    const sbom = h.runNode(root, 'scripts/sbom.js', ['--root', root, '--out', 'sbom.cdx.json']);
    h.record(ledger, 'sbom:run', sbom.code === 0 ? 'pass' : 'fail',
      `code=${sbom.code}`, sbom.stdout, sbom.stderr);

    // 3) Verify SBOM shape.
    const sbomPath = path.join(root, 'sbom.cdx.json');
    h.assert(fs.existsSync(sbomPath), 'sbom.cdx.json was not written');
    const sbomDoc = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
    h.assert(sbomDoc.bomFormat === 'CycloneDX', 'wrong bomFormat');
    h.assert(sbomDoc.specVersion === '1.5', 'wrong specVersion');
    h.assert(Array.isArray(sbomDoc.components) && sbomDoc.components.length >= 1,
      'sbom.components is empty');
    h.record(ledger, 'sbom:verify-shape', 'pass',
      `components=${sbomDoc.components.length}`);

    // 4) Exercise logger redaction.
    const logger = require(path.join(h.FDP_ROOT, 'forge-cli', 'lib', 'logger.js'));
    logger.reset();
    const captured = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    const origStdout = process.stdout.write.bind(process.stdout);
    process.stderr.write = (chunk) => { captured.push(String(chunk)); return true; };
    process.stdout.write = (chunk) => { captured.push(String(chunk)); return true; };
    try {
      logger.info('hello', { token: 'sk-secret-thing-1234567890' });
    } finally {
      process.stderr.write = origStderr;
      process.stdout.write = origStdout;
    }
    const all = captured.join('');
    h.assert(!all.includes('sk-secret-thing-1234567890'),
      'logger leaked a secret');
    h.record(ledger, 'logger:redacts-secrets', 'pass', 'secret never leaked');

    // 5) Safe exec — must refuse unknown binaries.
    const exec = require(path.join(h.FDP_ROOT, 'forge-cli', 'lib', 'exec.js'));
    let refused = false;
    try { exec.execFileSafe('this-binary-does-not-exist', ['-x']); }
    catch { refused = true; }
    h.assert(refused, 'execFileSafe should fail loudly for unknown binaries');
    h.record(ledger, 'exec:rejects-missing-binary', 'pass');

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
