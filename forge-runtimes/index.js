'use strict';

/**
 * forge-runtimes/index.js  (P8 / 4.5.3)
 *
 * Dispatch table for runtime adapters. Each runtime exposes a `build(prompt,
 * opts) -> { args, stdin, env }` function that forge-agents/provider.js calls
 * to materialise a CLI invocation without inlining runtime-specific logic.
 */

const ADAPTERS = {
  'claude-code': () => require('./claude-code/flags.js'),
  'claude':      () => require('./claude-code/flags.js'),
  'codex':       () => require('./codex/flags.js'),
  'openhands':   () => require('./openhands/flags.js'),
  'gemini-cli':  () => require('./gemini-cli/flags.js'),
  'gemini':      () => require('./gemini-cli/flags.js'),
};

function get(runtime) {
  const key = String(runtime || '').toLowerCase();
  const factory = ADAPTERS[key];
  if (!factory) return null;
  try { return factory(); }
  catch { return null; }
}

function build(runtime, prompt, opts) {
  const adapter = get(runtime);
  if (!adapter) {
    throw new Error(`forge-runtimes: unknown runtime '${runtime}'`);
  }
  return adapter.build(prompt, opts);
}

function list() {
  return Object.keys(ADAPTERS);
}

module.exports = { get, build, list };
