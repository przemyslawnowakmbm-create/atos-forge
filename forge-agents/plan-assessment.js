'use strict';

/**
 * forge-agents/plan-assessment.js
 *
 * Thin re-export wrapper around forge-assess/assessor.js.
 * Callers in drift.cjs and req-impact.cjs require this path to access
 * parsePlan and related utilities without taking a direct dependency on
 * forge-assess from inside forge-agents consumers.
 */

let assessor;
try {
  assessor = require('../forge-assess/assessor');
} catch (err) {
  const msg =
    '[forge-agents/plan-assessment] Could not load forge-assess/assessor.js. ' +
    'Ensure the forge-assess module is present alongside forge-agents in the Forge root. ' +
    'Original error: ' + err.message;
  throw new Error(msg);
}

module.exports = {
  parsePlan:            assessor.parsePlan,
  assessPlan:           assessor.assessPlan,
  estimateTokens:       assessor.estimateTokens,
  estimateFileTokens:   assessor.estimateFileTokens,
  classifyFile:         assessor.classifyFile,
  buildDependencyOrder: assessor.buildDependencyOrder,
  loadForgeConfig:      assessor.loadForgeConfig,
  CONFIG_DEFAULTS:      assessor.CONFIG_DEFAULTS,
  USABLE_CONTEXT:       assessor.USABLE_CONTEXT,
  CONTEXT_LIMIT:        assessor.CONTEXT_LIMIT,
  SAFETY_MARGIN:        assessor.SAFETY_MARGIN,
  OVERHEAD_PER_SUBTASK: assessor.OVERHEAD_PER_SUBTASK,
  MIN_ACTION_BUDGET:    assessor.MIN_ACTION_BUDGET,
  CHARS_PER_TOKEN:      assessor.CHARS_PER_TOKEN,
};
