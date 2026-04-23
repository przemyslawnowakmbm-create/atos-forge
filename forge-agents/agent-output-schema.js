'use strict';

/**
 * Agent Output Schema — structured JSON output from agents
 * Parsed from stdout after agent execution.
 */

const AGENT_OUTPUT_SCHEMA = {
  findings: [{ type: 'string', file: 'string', line: 'number', description: 'string', severity: 'string' }],
  decisions_made: [{ text: 'string', rationale: 'string' }],
  files_created: ['string'],
  files_modified: ['string'],
  files_not_touched: ['string'],
  confidence: 'number',
};

const REQUIRED_FIELDS = ['findings', 'decisions_made', 'files_created', 'files_modified', 'confidence'];

function parseAgentOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  // Strip Claude Code's [rerun: bN] footer from persisted Bash tool outputs
  const cleaned = stdout.replace(/\n?\[rerun: b\d+\]\s*$/g, '');
  // Look for ```json:agent-output ... ``` block
  const match = cleaned.match(/```json:agent-output\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Validate agent output against the required schema.
 *
 * @param {unknown} output - The parsed agent output object to validate.
 * @returns {{ valid: boolean, issues: string[], normalized: object|null }}
 */
function validateOutput(output) {
  const issues = [];

  if (!output || typeof output !== 'object') {
    issues.push('Agent output is not a valid object');
    return { valid: false, issues, normalized: null };
  }

  if (!Array.isArray(output.findings)) issues.push('findings must be an array');
  if (!Array.isArray(output.decisions_made)) issues.push('decisions_made must be an array');
  if (!Array.isArray(output.files_created)) issues.push('files_created must be an array');
  if (!Array.isArray(output.files_modified)) issues.push('files_modified must be an array');
  if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
    issues.push('confidence must be a number between 0 and 1');
  }

  // Validate finding structure
  if (Array.isArray(output.findings)) {
    for (const f of output.findings) {
      if (!f.type || !f.description) {
        issues.push(`Finding missing type or description: ${JSON.stringify(f).substring(0, 100)}`);
      }
    }
  }

  return { valid: issues.length === 0, issues, normalized: output };
}

module.exports = { AGENT_OUTPUT_SCHEMA, REQUIRED_FIELDS, parseAgentOutput, validateOutput };
