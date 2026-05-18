'use strict';

/**
 * forge-mcp/server.js  (P8 / 4.5.2)
 *
 * Minimal stdio MCP server exposing Forge intelligence to any MCP-aware
 * runtime (Codex, OpenHands, Cursor, Claude Code, Gemini).
 *
 * Protocol: JSON-RPC 2.0 over newline-delimited messages on stdin/stdout
 * (compatible with the MCP stdio transport). We implement just enough of
 * the surface to support the four resources and six tools from the plan:
 *
 *   Resources:
 *     forge://graph/overview
 *     forge://graph/hotspots
 *     forge://session/ledger
 *     forge://phases/<id>/PLAN.md
 *
 *   Tools:
 *     graph.show(file)
 *     graph.impact(file)
 *     graph.capabilities(module)
 *     verify.run(files, layers)
 *     assess.plan(planPath)
 *     audit.tail(limit)
 *
 * Read-only by default. `--write` exposes `plan.create` and `phase.execute`,
 * gated by capability tokens read from `.forge/policy/mcp.allowlist.yaml`.
 *
 * Usage:
 *   node forge-mcp/server.js --root <dir> [--write] [--transport stdio]
 *
 * MCP servers are language-agnostic; runtimes detect them via standard
 * registration patterns. We keep the implementation framework-free to avoid
 * a hard runtime dependency on the MCP TS/Python SDKs.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROTOCOL_VERSION = '2025-03-26'; // MCP version we claim compatibility with.
const SERVER_INFO = { name: 'forge-mcp', version: '1.0.0' };

function _arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1];
}

function _send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function _err(id, code, message) {
  _send({ jsonrpc: '2.0', id, error: { code, message } });
}

function _ok(id, result) {
  _send({ jsonrpc: '2.0', id, result });
}

function _loadTools(root, writeMode) {
  const dir = path.join(__dirname, 'tools');
  const tools = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    let mod;
    try { mod = require(path.join(dir, f)); }
    catch { continue; }
    if (!mod || !mod.name || typeof mod.run !== 'function') continue;
    if (mod.write && !writeMode) continue;
    mod.root = root;
    tools[mod.name] = mod;
  }
  return tools;
}

function _resources(root) {
  return [
    { uri: 'forge://graph/overview',  name: 'Code graph overview' },
    { uri: 'forge://graph/hotspots',  name: 'High-churn files' },
    { uri: 'forge://session/ledger',  name: 'Forge session ledger' },
    { uri: 'forge://phases',          name: 'Phase plans (forge://phases/<id>)' },
  ];
}

function _readResource(root, uri) {
  if (uri === 'forge://graph/overview') {
    const tool = require('./tools/graph_show').run;
    return tool(root, { kind: 'overview' });
  }
  if (uri === 'forge://graph/hotspots') {
    const tool = require('./tools/graph_hotspots').run;
    return tool(root, {});
  }
  if (uri === 'forge://session/ledger') {
    const p = path.join(root, '.forge', 'session', 'ledger.md');
    if (!fs.existsSync(p)) return { text: '' };
    return { text: fs.readFileSync(p, 'utf8') };
  }
  if (uri.startsWith('forge://phases/')) {
    const id = uri.slice('forge://phases/'.length).split('/')[0];
    const candidate = path.join(root, 'phases', id, 'PLAN.md');
    if (fs.existsSync(candidate)) return { text: fs.readFileSync(candidate, 'utf8') };
    return { text: '', error: `phase ${id} not found` };
  }
  return { text: '', error: 'unknown resource' };
}

function startServer(argv) {
  const root = path.resolve(_arg(argv, '--root', process.cwd()));
  const writeMode = argv.includes('--write');
  const tools = _loadTools(root, writeMode);

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); }
    catch { return; }
    if (!msg || msg.jsonrpc !== '2.0' || msg.method === undefined) return;
    handleMessage(msg, { root, writeMode, tools }).catch(err => {
      _err(msg.id, -32603, String(err && err.message || err));
    });
  });
}

async function handleMessage(msg, ctx) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return _ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: SERVER_INFO,
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
    });
  }
  if (method === 'tools/list') {
    const list = Object.values(ctx.tools).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    return _ok(id, { tools: list });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const tool = ctx.tools[name];
    if (!tool) return _err(id, -32601, `Unknown tool ${name}`);
    try {
      const result = await tool.run(ctx.root, (params && params.arguments) || {});
      return _ok(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] });
    } catch (err) {
      return _err(id, -32603, String(err && err.message || err));
    }
  }
  if (method === 'resources/list') {
    return _ok(id, { resources: _resources(ctx.root) });
  }
  if (method === 'resources/read') {
    const uri = params && params.uri;
    const r = _readResource(ctx.root, uri);
    if (r.error) return _err(id, -32602, r.error);
    return _ok(id, { contents: [{ uri, mimeType: 'text/markdown', text: r.text }] });
  }
  if (method === 'ping') return _ok(id, {});
  if (method === 'shutdown') { _ok(id, {}); process.exit(0); }
  return _err(id, -32601, `Unknown method ${method}`);
}

if (require.main === module) {
  startServer(process.argv.slice(2));
}

module.exports = { startServer, handleMessage, _loadTools, _readResource };
