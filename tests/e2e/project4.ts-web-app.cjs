'use strict';

/**
 * tests/e2e/project4.ts-web-app.cjs
 *
 * Project 4: TypeScript web app.
 * Exercises P5 (verification cache + metrics batcher + tokenizer) and the
 * structural verification layer (layer 1).
 */

const path = require('path');
const fs = require('fs');
const h = require('./harness.cjs');

function run() {
  const ledger = h.newLedger('project4-ts-web-app');
  const root = h.createProject('ts-web-app');
  try {
    h.writeFile(root, 'src/index.ts',
      "export function greet(name: string): string {\n" +
      "  return `Hello, ${name}!`;\n" +
      "}\n");
    h.writeFile(root, 'tsconfig.json', JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true, noEmit: true },
      include: ['src/**/*.ts'],
    }, null, 2));
    h.gitInit(root);

    // 1) Tokenizer registry (P5/P6).
    const tk = require(path.join(h.FDP_ROOT, 'forge-assess', 'tokenizers', 'index.js'));
    const e1 = tk.estimateTokens('Hello, world!', root);
    h.assert(typeof e1 === 'number' && e1 > 0, 'estimate should return positive number');
    const adapter = tk.getTokenizer(root);
    h.assert(adapter && typeof adapter.name === 'string',
      'tokenizer registry returned no adapter');
    h.record(ledger, 'tokenizer:estimates-tokens', 'pass',
      `name=${adapter.name} est("Hello, world!") = ${e1}`);

    // 2) Verification cache (P5). cache.set(layer, files, cwd, result).
    const cache = require(path.join(h.FDP_ROOT, 'forge-verify', 'cache.js'));
    h.writeFile(root, 'src/probe.ts', "export const probe = 42;\n");
    cache.set('structural', ['src/probe.ts'], root, { ok: true, errors: [] });
    const hit = cache.get('structural', ['src/probe.ts'], root);
    h.assert(hit && hit.ok === true, 'cache should return what was stored');
    h.record(ledger, 'verify:cache-hit', 'pass');

    // 3) Metrics batcher (P5).
    const batcher = require(path.join(h.FDP_ROOT, 'forge-session', 'metrics-batcher.js'));
    batcher.snapshot(root, { type: 'agent', id: 'e2e-1', model: 'inherit',
      tokens: { input: 100, output: 50, cache_read: 0, cache_write: 0, total: 150 },
      cost_usd: 0.0012, tool_calls: 3 });
    batcher.snapshot(root, { type: 'agent', id: 'e2e-2', model: 'inherit',
      tokens: { input: 200, output: 100, cache_read: 0, cache_write: 0, total: 300 },
      cost_usd: 0.0024, tool_calls: 5 });
    batcher.flushOne(String(root));
    const metricsFile = path.join(root, '.forge', 'session', 'metrics.json');
    h.assert(fs.existsSync(metricsFile), 'metrics file should be written');
    const metricsDoc = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
    h.assert(Array.isArray(metricsDoc.units) && metricsDoc.units.length === 2,
      `metrics units=${metricsDoc.units && metricsDoc.units.length}`);
    h.record(ledger, 'metrics:batcher-flushes', 'pass',
      `units=${metricsDoc.units.length}`);

    // 4) Structural verification layer rejects merge-conflict markers.
    h.writeFile(root, 'src/conflicted.ts',
      "export const x = 1;\n<<<<<<< HEAD\nexport const y = 2;\n=======\nexport const y = 3;\n>>>>>>> branch\n");
    const engine = require(path.join(h.FDP_ROOT, 'forge-verify', 'engine.js'));
    const struct = engine.layerStructural({
      cwd: root,
      files: ['src/conflicted.ts'],
    });
    h.assert(struct && struct.passed === false,
      'structural layer must reject conflict markers');
    h.record(ledger, 'verify:layer-structural-fails-on-conflict', 'pass');

    // 5) Structural layer accepts clean file.
    const cleanStruct = engine.layerStructural({
      cwd: root,
      files: ['src/index.ts'],
    });
    h.assert(cleanStruct && cleanStruct.passed === true,
      'structural layer should accept clean file');
    h.record(ledger, 'verify:layer-structural-passes-clean', 'pass');

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
