'use strict';

/**
 * forge-mcp/tools/audit_tail.js  (P8 / 4.5.2)
 *
 * MCP tool: audit.tail — return the last N records from the signed audit
 * log (`.forge/audit/audit.jsonl`).
 */

const path = require('path');

function _audit(root) {
  return require(path.join(root, 'forge-session', 'audit.js'));
}

function run(root, args) {
  const limit = (args && Number(args.limit)) || 20;
  try {
    const records = _audit(root).tail(root, limit);
    return { ok: true, count: records.length, records };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  name: 'audit.tail',
  description: 'Tail the last N records from the signed audit log.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'How many records (default 20).' },
    },
  },
  run,
};
