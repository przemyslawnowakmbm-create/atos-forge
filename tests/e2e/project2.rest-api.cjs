'use strict';

/**
 * tests/e2e/project2.rest-api.cjs
 *
 * Project 2: REST API service.
 * Exercises P2 (audit log + identity + redactor) and P7 (action-observation
 * log via the actions CLI subcommand).
 */

const path = require('path');
const fs = require('fs');
const h = require('./harness.cjs');

function run() {
  const ledger = h.newLedger('project2-rest-api');
  const root = h.createProject('rest-api');
  try {
    // 1) Seed a tiny express-ish handler so the project looks real.
    h.writeFile(root, 'src/server.js',
      "'use strict';\nconst http = require('http');\n" +
      "const server = http.createServer((req, res) => { res.end('ok'); });\n" +
      "if (require.main === module) server.listen(0);\n" +
      "module.exports = { server };\n");
    h.gitInit(root);

    // 2) Identity emit (P2).
    const identity = require(path.join(h.FDP_ROOT, 'forge-session', 'identity.js'));
    const actorId = identity.actor(root);
    h.assert(typeof actorId === 'string' && actorId.length > 0,
      'identity did not resolve');
    h.record(ledger, 'identity:resolves', 'pass', `actor=${actorId}`);

    // 3) Redactor scrubs sensitive payload (P2). The patterns operate on
    //    strings, so we feed it a log line containing a recognisable secret.
    const redactor = require(path.join(h.FDP_ROOT, 'forge-session', 'redactor.js'));
    const dirty = {
      user: 'alice',
      log: 'auth: token="sk-ant-abcdefghij0123456789KLMNOP" gh=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };
    const cleaned = redactor.redactValue(dirty);
    const cleanedStr = JSON.stringify(cleaned);
    h.assert(!cleanedStr.includes('sk-ant-abcdefghij0123456789KLMNOP'),
      'anthropic token leaked');
    h.assert(!cleanedStr.includes('ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      'github PAT leaked');
    h.record(ledger, 'redactor:scrubs-secrets', 'pass',
      'anthropic + gh PAT redacted');

    // 4) Audit append + tail (P2).
    const audit = require(path.join(h.FDP_ROOT, 'forge-session', 'audit.js'));
    // Enable audit by writing the marker config.
    h.writeFile(root, '.forge/config.json', JSON.stringify({
      audit: { enabled: true },
      log: { level: 'info', json: false },
      actions: { log: { enabled: true, dir: '.forge/actions' } },
    }, null, 2));
    audit.append(root, { action: 'test_event', actor: actorId, payload: { n: 1 } });
    audit.append(root, { action: 'test_event', actor: actorId, payload: { n: 2 } });
    const tail = audit.tail(root, 5);
    h.assert(Array.isArray(tail) && tail.length >= 2, 'audit tail empty');
    h.record(ledger, 'audit:append-tail', 'pass', `tail=${tail.length}`);

    // 5) Audit signature chain verifies.
    const verifyRes = audit.verify(root);
    h.assert(verifyRes && verifyRes.ok === true, 'audit hash chain broken');
    h.record(ledger, 'audit:hash-chain-verifies', 'pass');

    // 6) Action/observation log via forge-tools (P7).
    const phase = 'p1';
    const wave = 'w1';
    const agent = 'agent-a';
    const r1 = h.runForge(root, ['actions', 'log', 'action', phase, wave, agent,
      '--type', 'edit', '--path', 'src/server.js', '--payload', JSON.stringify({ size: 12 })]);
    h.assert(r1.code === 0, `actions log action failed: ${r1.stderr}`);
    const r2 = h.runForge(root, ['actions', 'log', 'observation', phase, wave, agent,
      '--type', 'edit_result', '--exit', '0', '--duration', '17']);
    h.assert(r2.code === 0, `actions log observation failed: ${r2.stderr}`);
    h.record(ledger, 'actions:log-action+observation', 'pass');

    // 7) actions tail returns 2 entries.
    const r3 = h.runForge(root, ['actions', 'tail', phase, wave, agent]);
    const lines = r3.stdout.trim().split('\n').filter(Boolean);
    h.assert(lines.length === 2, `expected 2 entries, got ${lines.length}`);
    for (const ln of lines) JSON.parse(ln); // each line is valid JSON
    h.record(ledger, 'actions:tail-roundtrips', 'pass', `lines=${lines.length}`);

    // 8) actions replay renders action→observation pair lines.
    const r4 = h.runForge(root, ['actions', 'replay', phase, wave, agent]);
    h.assert(r4.stdout.includes('→ edit') && r4.stdout.includes('← edit_result'),
      'replay did not render pair');
    h.record(ledger, 'actions:replay-renders-pair', 'pass');

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
