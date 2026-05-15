'use strict';

/**
 * Audit log CLI — wraps forge-session/audit.js.
 *
 * Subcommands:
 *   tail [N]      — last N records (default 20)
 *   verify        — walk the chain and verify hashes (+ sigs if identity present)
 *   export        — print full envelope { count, head, tail, records } as JSON
 *   append <action> [--subject S] [--payload-json '{...}']
 */

const path = require('path');
const { output, error, getForgeRoot } = require('./core.cjs');

async function handleAudit(cwd, args, raw) {
  const audit = require(path.join(getForgeRoot(), 'forge-session', 'audit'));
  const sub = (args[0] || 'tail').toLowerCase();

  try {
    if (sub === 'tail') {
      const n = Number(args[1]) > 0 ? Number(args[1]) : 20;
      const rows = audit.tail(cwd, n);
      if (raw) return output(rows, raw);
      if (rows.length === 0) { console.log('Audit log is empty.'); return; }
      for (const r of rows) {
        const sub = r.subject ? ` :: ${r.subject}` : '';
        console.log(`[${r.ts}] ${r.actor}  ${r.action}${sub}  (hash=${r.hash.slice(0, 12)}…${r.sig ? ' signed' : ''})`);
      }
      return;
    }

    if (sub === 'verify') {
      const result = audit.verify(cwd);
      if (raw) return output(result, raw);
      if (result.ok) {
        console.log(`Audit log OK — ${result.count} records, chain intact.`);
      } else {
        console.log(`Audit log FAILED — ${result.errors.length} error(s) across ${result.count} records:`);
        for (const e of result.errors) console.log(`  line ${e.line}: ${e.reason}`);
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'export') {
      const env = audit.exportLog(cwd);
      output(env, true);
      return;
    }

    if (sub === 'append') {
      const action = args[1];
      if (!action) { error('Usage: audit append <action> [--subject S] [--payload-json {...}]'); return; }
      const subjIdx = args.indexOf('--subject');
      const payIdx = args.indexOf('--payload-json');
      const subject = subjIdx >= 0 ? args[subjIdx + 1] : null;
      let payload = null;
      if (payIdx >= 0) {
        try { payload = JSON.parse(args[payIdx + 1]); }
        catch { error('--payload-json must be valid JSON'); return; }
      }
      const rec = audit.append(cwd, { action, subject, payload });
      if (raw) return output(rec, raw);
      if (rec) console.log(`Appended ${rec.action} (hash=${rec.hash.slice(0, 12)}…)`);
      else console.log('Audit disabled (audit.enabled = false).');
      return;
    }

    error('Unknown audit subcommand. Available: tail, verify, export, append');
  } catch (e) {
    error('Audit error: ' + e.message);
  }
}

module.exports = { handleAudit };
