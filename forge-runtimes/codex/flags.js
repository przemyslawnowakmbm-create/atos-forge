'use strict';

/**
 * forge-runtimes/codex/flags.js  (P8 / 4.5.3)
 *
 * Build the argv + env for OpenAI Codex CLI (`codex exec`).
 * Mirrors the inline implementation that was previously in
 * `forge-agents/provider.js` so existing tests continue to pass.
 */

function build(prompt, opts) {
  opts = opts || {};
  const args = ['exec', '--full-auto', '--skip-git-repo-check'];
  if (opts.model) args.push('-m', opts.model);
  if (opts.outputFile) args.push('-o', opts.outputFile);
  args.push('-');
  return {
    args,
    stdin: prompt,
    env: { TERM: 'dumb' },
  };
}

module.exports = { build };
