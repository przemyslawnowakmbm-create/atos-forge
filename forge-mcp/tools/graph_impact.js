'use strict';

/**
 * forge-mcp/tools/graph_impact.js  (P8 / 4.5.2)
 *
 * MCP tool: graph.impact — return the transitive impact / blast radius
 * for a file.
 */

const path = require('path');

function _q(root) {
  return require(path.join(root, 'forge-graph', 'query.js'));
}

function run(root, args) {
  const file = args && args.file;
  if (!file || typeof file !== 'string') {
    return { ok: false, error: 'missing required arg: file' };
  }
  try {
    const impact = _q(root).getImpact(file, { depth: args.depth || 3 });
    return { ok: true, file, impact };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  name: 'graph.impact',
  description: 'Compute transitive impact (blast radius) for a file.',
  inputSchema: {
    type: 'object',
    properties: {
      file:  { type: 'string', description: 'Path relative to the repo root.' },
      depth: { type: 'number', description: 'Max transitive depth (default 3).' },
    },
    required: ['file'],
  },
  run,
};
