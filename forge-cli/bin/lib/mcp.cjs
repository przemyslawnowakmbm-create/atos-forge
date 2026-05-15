'use strict';

/**
 * forge-cli/bin/lib/mcp.cjs  (P8 / 4.5.2)
 *
 * CLI handler for the Forge MCP server.
 *
 * Subcommands:
 *   mcp serve [--write] [--root .]   — start the stdio MCP server.
 *   mcp list                         — list resources the server exposes.
 *   mcp tools                        — list tools the server exposes.
 *   mcp call <tool> [--args <json>]  — call a tool once and print the result.
 *
 * The `serve` subcommand replaces the binary with `node forge-mcp/server.js`
 * via require — useful for `npx forge-tools.cjs mcp serve` inside MCP host
 * configs.
 */

const path = require('path');

function _mcpServer() {
  return require(path.join(__dirname, '..', '..', '..', 'forge-mcp', 'server.js'));
}

function _loadTools(root, writeMode) {
  const { _loadTools } = _mcpServer();
  return _loadTools(root, writeMode);
}

function _resources(root) {
  const server = _mcpServer();
  // server.js exports _readResource and not _resources; rebuild the list here
  // (it's intentionally small).
  return [
    { uri: 'forge://graph/overview',  name: 'Code graph overview' },
    { uri: 'forge://graph/hotspots',  name: 'High-churn files' },
    { uri: 'forge://session/ledger',  name: 'Forge session ledger' },
    { uri: 'forge://phases',          name: 'Phase plans (forge://phases/<id>)' },
  ];
}

function handleCli(cwd, argv) {
  const sub = argv[0] || 'tools';
  if (sub === 'serve') {
    const writeMode = argv.includes('--write');
    const rootIdx = argv.indexOf('--root');
    const root = rootIdx !== -1 ? path.resolve(argv[rootIdx + 1]) : cwd;
    const { startServer } = _mcpServer();
    const passthrough = ['--root', root];
    if (writeMode) passthrough.push('--write');
    startServer(passthrough);
    return;
  }
  if (sub === 'list' || sub === 'resources') {
    const list = _resources(cwd);
    for (const r of list) process.stdout.write(`${r.uri}\t${r.name}\n`);
    return;
  }
  if (sub === 'tools') {
    const writeMode = argv.includes('--write');
    const tools = _loadTools(cwd, writeMode);
    if (Object.keys(tools).length === 0) {
      process.stdout.write('(no tools)\n'); return;
    }
    for (const name of Object.keys(tools).sort()) {
      const t = tools[name];
      process.stdout.write(`${name}\t${t.description || ''}\n`);
    }
    return;
  }
  if (sub === 'call') {
    const name = argv[1];
    if (!name) {
      process.stderr.write('mcp call: missing <tool>\n'); process.exit(2);
    }
    const argsIdx = argv.indexOf('--args');
    let toolArgs = {};
    if (argsIdx !== -1) {
      try { toolArgs = JSON.parse(argv[argsIdx + 1] || '{}'); }
      catch (err) {
        process.stderr.write(`mcp call: --args must be valid JSON (${err.message})\n`);
        process.exit(2);
      }
    }
    const writeMode = argv.includes('--write');
    const tools = _loadTools(cwd, writeMode);
    const tool = tools[name];
    if (!tool) {
      process.stderr.write(`mcp call: unknown tool '${name}'.\n`);
      process.exit(1);
    }
    Promise.resolve()
      .then(() => tool.run(cwd, toolArgs))
      .then(result => {
        process.stdout.write(
          (typeof result === 'string' ? result : JSON.stringify(result, null, 2)) + '\n'
        );
      })
      .catch(err => {
        process.stderr.write(`mcp call: ${err && err.message || err}\n`);
        process.exit(1);
      });
    return;
  }
  process.stderr.write(`mcp: unknown subcommand '${sub}'.\n`);
  process.exit(2);
}

module.exports = { handleCli };
