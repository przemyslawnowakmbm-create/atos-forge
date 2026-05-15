'use strict';

/**
 * forge-runtimes/openhands/flags.js  (P8 / 4.5.3)
 *
 * Build the argv + env for OpenHands CLI (`openhands` / `python -m openhands`).
 *
 * Note: OpenHands is task-oriented; we hand it a task body via stdin and
 * collect the agent's final output from `outputFile` when provided.
 */

function build(prompt, opts) {
  opts = opts || {};
  const args = ['--no-banner'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.outputFile) args.push('--output', opts.outputFile);
  // Capability hooks: openhands supports --allowed-tools (subset of Forge tools).
  if (Array.isArray(opts.allowedTools) && opts.allowedTools.length > 0) {
    args.push('--allowed-tools', opts.allowedTools.join(','));
  }
  return {
    args,
    stdin: prompt,
    env: { TERM: 'dumb' },
  };
}

module.exports = { build };
