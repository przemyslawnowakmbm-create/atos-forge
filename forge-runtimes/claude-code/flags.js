'use strict';

/**
 * forge-runtimes/claude-code/flags.js  (P8 / 4.5.3)
 *
 * Build the argv + env for `claude` (Claude Code CLI). This is the
 * canonical runtime adapter — `forge-agents/provider.js` historically
 * inlined this; we now delegate.
 */

function build(prompt, opts) {
  opts = opts || {};
  const baseTools = Array.isArray(opts.allowedTools)
    ? opts.allowedTools.join(',')
    : (opts.allowedTools || 'Bash,Read,Write,Edit,Glob,Grep');
  const finalTools = opts.delegate_to_agents === true
    ? `${baseTools},Agent`
    : baseTools;

  const useDangerous = opts.dangerously_skip_permissions !== false;
  const args = ['--print'];
  if (useDangerous) args.push('--dangerously-skip-permissions');
  args.push('-p', prompt, '--allowedTools', finalTools);
  if (Array.isArray(opts.disallowedTools) && opts.disallowedTools.length > 0) {
    args.push('--disallowedTools', opts.disallowedTools.join(','));
  }
  const model = opts.model;
  if (model && model !== 'inherit') {
    args.splice(1, 0, '--model', model);
  }
  return {
    args,
    stdin: null,
    env: {
      TERM: 'dumb',
      CLAUDE_CODE_ENTRYPOINT:
        opts.entrypoint || process.env.CLAUDE_CODE_ENTRYPOINT,
    },
  };
}

module.exports = { build };
