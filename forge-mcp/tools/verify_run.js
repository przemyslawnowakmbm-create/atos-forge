'use strict';

/**
 * forge-mcp/tools/verify_run.js  (P8 / 4.5.2)
 *
 * MCP tool: verify.run — run the 16-layer verification engine and return
 * the structured result.
 */

const path = require('path');

function _engine(root) {
  return require(path.join(root, 'forge-verify', 'engine.js'));
}

async function run(root, args) {
  const files = Array.isArray(args && args.files) ? args.files : undefined;
  const plan = args && args.plan ? String(args.plan) : undefined;
  const layer = args && args.layer != null ? Number(args.layer) : undefined;
  try {
    const result = await _engine(root).verify({
      cwd: root,
      files,
      plan,
      layer,
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  name: 'verify.run',
  description: 'Run the 16-layer fail-fast verification engine.',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to verify (default: changed files).',
      },
      plan:  { type: 'string', description: 'Optional plan path.' },
      layer: { type: 'number', description: 'Run only one layer (0-15).' },
    },
  },
  run,
};
