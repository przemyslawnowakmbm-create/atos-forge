'use strict';

/**
 * forge-mcp/tools/assess_plan.js  (P8 / 4.5.2)
 *
 * MCP tool: assess.plan — run the assessor on a plan file and return the
 * strategy + token budget breakdown.
 */

const path = require('path');

function _assessor(root) {
  return require(path.join(root, 'forge-assess', 'assessor.js'));
}

function run(root, args) {
  const planPath = args && args.planPath;
  if (!planPath || typeof planPath !== 'string') {
    return { ok: false, error: 'missing required arg: planPath' };
  }
  const abs = path.isAbsolute(planPath) ? planPath : path.join(root, planPath);
  try {
    const result = _assessor(root).assessPlan(abs, root, args || {});
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  name: 'assess.plan',
  description: 'Assess a plan: token budget, fit / split strategy, dependencies.',
  inputSchema: {
    type: 'object',
    properties: {
      planPath: { type: 'string', description: 'Path to plan file (PLAN.md).' },
    },
    required: ['planPath'],
  },
  run,
};
