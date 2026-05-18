'use strict';

/**
 * forge-cli/bin/lib/runtimes.cjs  (P8 / 4.5.3)
 *
 * CLI handler for inspecting the runtime adapter registry.
 *
 * Subcommands:
 *   runtimes list                                  — list known adapters.
 *   runtimes flags <runtime> <prompt> [--model M]  — print the argv/env
 *                                                    that would be built.
 */

const path = require('path');

function _runtimes() {
  return require(path.join(__dirname, '..', '..', '..', 'forge-runtimes'));
}

function _arg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}

function handleCli(cwd, argv) {
  const sub = argv[0] || 'list';
  const rt = _runtimes();
  if (sub === 'list') {
    for (const name of rt.list()) process.stdout.write(`${name}\n`);
    return;
  }
  if (sub === 'flags') {
    const runtime = argv[1];
    const prompt = argv[2];
    if (!runtime || !prompt) {
      process.stderr.write('usage: runtimes flags <runtime> <prompt> [--model M]\n');
      process.exit(2);
    }
    const opts = {};
    const model = _arg(argv, '--model');
    if (model) opts.model = model;
    const tools = _arg(argv, '--tools');
    if (tools) opts.allowedTools = tools.split(',');
    try {
      const built = rt.build(runtime, prompt, opts);
      process.stdout.write(JSON.stringify(built, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(`runtimes flags: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }
  process.stderr.write(`runtimes: unknown subcommand '${sub}'.\n`);
  process.exit(2);
}

module.exports = { handleCli };
