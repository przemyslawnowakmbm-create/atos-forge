'use strict';

/**
 * forge-mcp/tools/graph_hotspots.js  (P8 / 4.5.2)
 *
 * MCP tool / resource helper: graph.hotspots — high-churn / high-risk files.
 */

const path = require('path');

function _q(root) {
  return require(path.join(root, 'forge-graph', 'query.js'));
}

function run(root, args) {
  const limit = (args && Number(args.limit)) || 20;
  try {
    const hotspots = _q(root).getHotspots({ limit });
    return { ok: true, hotspots };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  name: 'graph.hotspots',
  description: 'Return the top-N hottest files in the codebase.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'How many hotspots to return (default 20).' },
    },
  },
  run,
};
