'use strict';

/**
 * forge-mcp/tools/graph_show.js  (P8 / 4.5.2)
 *
 * MCP tool: graph.show — return dependency / symbol detail for a single file,
 * or codebase overview when called with `{ kind: 'overview' }` (used by the
 * `forge://graph/overview` resource).
 */

const path = require('path');

function _q(root) {
  return require(path.join(root, 'forge-graph', 'query.js'));
}

function run(root, args) {
  const q = _q(root);
  if (args && args.kind === 'overview') {
    try {
      const overview = q.getOverview();
      return { ok: true, overview };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }
  const file = args && args.file;
  if (!file || typeof file !== 'string') {
    return { ok: false, error: 'missing required arg: file' };
  }
  try {
    const consumers = q.getConsumers(file);
    const context = q.getContextForTask([file]);
    return { ok: true, file, consumers, context };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  name: 'graph.show',
  description: 'Show graph context for a file: consumers, symbols, neighborhood.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Path relative to the repo root.' },
    },
    required: [],
  },
  run,
};
