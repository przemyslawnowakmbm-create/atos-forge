'use strict';

/**
 * forge-mcp/tools/graph_capabilities.js  (P8 / 4.5.2)
 *
 * MCP tool: graph.capabilities — list capabilities (exported behavioural
 * surface) for a module, derived from the code graph.
 */

const path = require('path');

function _q(root) {
  return require(path.join(root, 'forge-graph', 'query.js'));
}

function run(root, args) {
  const moduleName = args && args.module;
  if (!moduleName || typeof moduleName !== 'string') {
    return { ok: false, error: 'missing required arg: module' };
  }
  try {
    const caps = _q(root).getCapabilities(moduleName);
    return { ok: true, module: moduleName, capabilities: caps };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  name: 'graph.capabilities',
  description: 'List capabilities (exported behavioural surface) of a module.',
  inputSchema: {
    type: 'object',
    properties: {
      module: { type: 'string', description: 'Module name (folder name).' },
    },
    required: ['module'],
  },
  run,
};
