'use strict';

/**
 * forge-runtimes/gemini-cli/flags.js  (P8 / 4.5.3)
 *
 * Build the argv + env for Gemini CLI (`gemini`).
 */

function build(prompt, opts) {
  opts = opts || {};
  const args = ['--prompt', prompt, '--quiet'];
  if (opts.model) args.unshift('--model', opts.model);
  if (opts.outputFile) args.push('--output', opts.outputFile);
  if (Array.isArray(opts.allowedTools) && opts.allowedTools.length > 0) {
    args.push('--tools', opts.allowedTools.join(','));
  }
  return {
    args,
    stdin: null,
    env: { TERM: 'dumb' },
  };
}

module.exports = { build };
