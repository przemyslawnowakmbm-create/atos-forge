'use strict';

/**
 * forge-cli/bin/lib/actions.cjs  (P7 / 4.4.6)
 *
 * CLI handler for the action-observation log.
 *
 * Subcommands:
 *   actions list                            — list every recorded agent log.
 *   actions tail <phase> <wave> <agent>     — print the agent's log lines.
 *   actions replay <phase> <wave> <agent>   — pretty-print action↔observation pairs.
 *   actions log action <phase> <wave> <agent> --type <t> [--path <p>] [--payload <json>]
 *   actions log observation <phase> <wave> <agent> --type <t> [--exit <n>] [--duration <ms>]
 *
 * The `log` subcommand is intended for shell-hook callers and tests; in
 * normal use Forge writes through `forge-session/actions.js` directly.
 */

const path = require('path');

function _actions() {
  return require(path.join('..', '..', '..', 'forge-session', 'actions.js'));
}

function _arg(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1];
}

function _ctx(args) {
  const phase = args[0];
  const wave = args[1];
  const agent = args[2];
  if (!phase || !wave || !agent) {
    process.stderr.write('usage: actions <sub> <phase> <wave> <agent>\n');
    process.exit(2);
  }
  return { phase, wave, agent };
}

function handleCli(cwd, args) {
  const sub = args[0] || 'list';
  const a = _actions();
  if (sub === 'list') {
    const entries = a.listAllLogs(cwd);
    if (entries.length === 0) {
      process.stdout.write('(no action logs)\n'); return;
    }
    for (const e of entries) {
      process.stdout.write(`${e.phase}/${e.wave}/${e.agent}\t${e.file}\n`);
    }
    return;
  }
  if (sub === 'tail') {
    const ctx = _ctx(args.slice(1));
    const records = a.readLog(cwd, ctx);
    for (const r of records) process.stdout.write(JSON.stringify(r) + '\n');
    return;
  }
  if (sub === 'replay') {
    const ctx = _ctx(args.slice(1));
    const records = a.readLog(cwd, ctx);
    let last = null;
    for (const r of records) {
      if (r.kind === 'action') {
        process.stdout.write(`→ ${r.type}${r.path ? ` ${r.path}` : ''}\n`);
        last = r;
      } else if (r.kind === 'observation') {
        const dur = r.duration_ms != null ? ` (${r.duration_ms}ms)` : '';
        const exit = r.exit != null ? ` exit=${r.exit}` : '';
        process.stdout.write(`← ${r.type}${exit}${dur}\n`);
        last = null;
      }
    }
    return;
  }
  if (sub === 'log') {
    const kind = args[1];
    const ctx = _ctx(args.slice(2, 5));
    const type = _arg(args, '--type') || 'unknown';
    const p = _arg(args, '--path');
    const payloadRaw = _arg(args, '--payload');
    const exit = _arg(args, '--exit');
    const duration = _arg(args, '--duration');
    if (kind === 'action') {
      let payload = null;
      if (payloadRaw) {
        try { payload = JSON.parse(payloadRaw); } catch { payload = payloadRaw; }
      }
      a.logAction(cwd, ctx, { type, path: p, payload });
    } else if (kind === 'observation') {
      a.logObservation(cwd, ctx, {
        type,
        exit: exit != null ? Number(exit) : undefined,
        duration_ms: duration != null ? Number(duration) : undefined,
      });
    } else {
      process.stderr.write(`actions log: unknown kind '${kind}'.\n`);
      process.exit(2);
    }
    process.stdout.write('ok\n');
    return;
  }
  process.stderr.write(`actions: unknown subcommand '${sub}'.\n`);
  process.exit(2);
}

module.exports = { handleCli };
