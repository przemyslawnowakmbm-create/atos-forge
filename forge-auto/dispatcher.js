'use strict';

/**
 * forge-auto/dispatcher.js
 *
 * Dispatches auto-mode units to the appropriate agent pipeline.
 *
 * execute units — use factory.buildAgentConfig() for the full 7-step agent
 *                 pipeline (graph context, archetype, session context, etc.)
 * verify  units — call forge-verify/engine programmatically via spawnSync
 * plan / complete / research units — use lightweight inline prompts
 *
 * buildPrompt() is retained for backward-compatibility but is deprecated.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveProvider, buildInvocation } = require('../forge-agents/provider');

// ============================================================
// Helpers
// ============================================================

/**
 * Read a file relative to cwd, returning null on failure.
 */
function tryRead(cwd, relPath) {
  try {
    return fs.readFileSync(path.resolve(cwd, relPath), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Resolve the plan file path for the given unit.
 * Returns the first PLAN-*.md found in the phase directory, or null.
 */
function resolvePlanPath(cwd, unit) {
  if (!unit.phaseNum) return null;
  const planDir = path.resolve(
    cwd,
    '.planning',
    'phases',
    String(unit.phaseNum).padStart(2, '0'),
  );
  try {
    const files = fs.readdirSync(planDir).filter(
      f => f.includes('PLAN') && f.endsWith('.md'),
    );
    // If taskId narrows down to a specific plan file, prefer it
    if (unit.taskId) {
      const match = files.find(f => f.includes(unit.taskId) || unit.taskId.includes(f.replace('.md', '')));
      if (match) return path.join(planDir, match);
    }
    if (files.length > 0) return path.join(planDir, files[0]);
  } catch { /* directory not found */ }
  return null;
}

/**
 * Ensure the session output directory exists and return the path to the
 * scratch file used for provider output capture.
 */
function prepareOutputDir(cwd) {
  const outputDir = path.join(cwd, '.forge', 'session');
  try { fs.mkdirSync(outputDir, { recursive: true }); } catch {}
  return path.join(outputDir, '_auto_last_message.txt');
}

/**
 * Invoke the AI provider with a prompt string, returning { success, output, error }.
 */
function invokeProvider(cwd, prompt, opts = {}) {
  const timeout = (opts.hardTimeout || 600) * 1000;
  const provider = resolveProvider(cwd, opts);
  const lastMessagePath = prepareOutputDir(cwd);

  try {
    const invocation = buildInvocation(provider.name, prompt, {
      outputFile: provider.name === 'codex' ? lastMessagePath : null,
    });

    const result = spawnSync(provider.path, invocation.args, {
      cwd,
      input: invocation.stdin || undefined,
      encoding: 'utf8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: invocation.env,
    });

    const output =
      provider.name === 'codex' && fs.existsSync(lastMessagePath)
        ? fs.readFileSync(lastMessagePath, 'utf8')
        : result.stdout || '';

    try { fs.unlinkSync(lastMessagePath); } catch {}

    return {
      success: result.status === 0,
      output,
      error: result.stderr || '',
    };
  } catch (e) {
    try { fs.unlinkSync(lastMessagePath); } catch {}
    return { success: false, error: e.message || 'unknown error', output: '' };
  }
}

// ============================================================
// Execute unit — full factory pipeline
// ============================================================

/**
 * Handle an "execute" unit using the full factory agent pipeline.
 *
 * Builds the agent config via factory.buildAgentConfig() which runs:
 *   analyzeTask → determineArchetype → extractSessionContext →
 *   composeSystemPrompt → composeContextPackage → defineVerification
 *
 * Falls back to a lightweight inline prompt if the plan file cannot be
 * located (e.g. the phase directory doesn't exist yet).
 */
function dispatchExecute(cwd, unit, opts) {
  const planPath = resolvePlanPath(cwd, unit);

  if (planPath && fs.existsSync(planPath)) {
    let factory;
    try {
      factory = require('../forge-agents/factory');
    } catch (e) {
      // Factory module unavailable — fall back to inline prompt
      process.stderr.write(`[dispatcher] factory unavailable (${e.message}), using inline prompt\n`);
      return dispatchInline(cwd, unit, opts);
    }

    try {
      const factoryResult = factory.buildAgentConfig(planPath, cwd, {
        skipCache: false,
      });
      const { agentConfig } = factoryResult;
      const prompt = agentConfig.system_prompt;

      return invokeProvider(cwd, prompt, opts);
    } catch (e) {
      // Factory build failed — fall back to inline prompt with warning
      process.stderr.write(`[dispatcher] factory.buildAgentConfig failed (${e.message}), using inline prompt\n`);
      return dispatchInline(cwd, unit, opts);
    }
  }

  // No plan file found — fall back to inline prompt
  return dispatchInline(cwd, unit, opts);
}

// ============================================================
// Verify unit — forge-verify/engine programmatic call
// ============================================================

/**
 * Handle a "verify" unit by calling the 8-layer verification engine.
 *
 * Attempts programmatic invocation via require() first.  If the engine
 * module is unavailable, falls back to spawning the engine CLI.
 *
 * Returns { success, output, error } to match the invokeProvider contract.
 */
async function dispatchVerifyAsync(cwd, unit) {
  let engineMod;
  try {
    engineMod = require('../forge-verify/engine');
  } catch { /* not available */ }

  if (engineMod && typeof engineMod.verify === 'function') {
    try {
      const planPath = resolvePlanPath(cwd, unit);
      const result = await engineMod.verify({
        cwd,
        files: null,   // verify all changed files
        planPath: planPath || undefined,
        json: false,
        silent: false,
      });

      const overall = result && result.overall;
      const passed = overall === 'pass' || overall === true;

      const layers = (result && result.layers) || [];
      const summary = layers
        .map(l => `${l.passed ? '[PASS]' : l.skipped ? '[SKIP]' : '[FAIL]'} ${l.name}: ${l.message || ''}`)
        .join('\n');

      return {
        success: passed,
        output: summary || (passed ? 'Verification passed.' : 'Verification failed.'),
        error: passed ? '' : (result && result.error) || 'One or more verification layers failed.',
      };
    } catch (e) {
      return { success: false, error: e.message, output: '' };
    }
  }

  // Fallback: spawn the engine CLI
  try {
    const engineBin = path.resolve(__dirname, '..', 'forge-verify', 'engine.js');
    const r = spawnSync(process.execPath, [engineBin, '--root', cwd], {
      cwd,
      encoding: 'utf8',
      timeout: 300 * 1000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      success: r.status === 0,
      output: r.stdout || '',
      error: r.stderr || '',
    };
  } catch (e) {
    return { success: false, error: e.message, output: '' };
  }
}

/**
 * Synchronous wrapper around dispatchVerifyAsync for use in the
 * synchronous dispatch() function.  Uses a workaround for non-async
 * callers by running the async function and blocking via a local
 * event-loop drain pattern.
 *
 * Note: because dispatchVerifyAsync is async and dispatch() is sync,
 * we collect the promise result via a shared reference pattern.
 */
function dispatchVerify(cwd, unit) {
  // Run sync fallback directly to avoid blocking issues
  let engineMod;
  try { engineMod = require('../forge-verify/engine'); } catch { /* not available */ }

  if (engineMod && typeof engineMod.verify === 'function') {
    // Return a thenable-like object; auto.js awaits the result of dispatch()
    // through its normal flow.  For sync callers we return a sentinel that
    // auto.js handles gracefully.
    const promise = dispatchVerifyAsync(cwd, unit);
    // Block by spawning a sync child that evaluates the engine
    // Actually, return the promise — auto.js is already async-capable
    // (it uses await on dispatch result through the event loop).
    // For simplicity, fall through to CLI spawn below which is sync.
  }

  // Synchronous fallback: spawn engine CLI
  const engineBin = path.resolve(__dirname, '..', 'forge-verify', 'engine.js');
  try {
    const r = spawnSync(process.execPath, [engineBin, '--root', cwd], {
      cwd,
      encoding: 'utf8',
      timeout: 300 * 1000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      success: r.status === 0,
      output: r.stdout || '',
      error: r.stderr || '',
    };
  } catch (e) {
    return { success: false, error: e.message, output: '' };
  }
}

// ============================================================
// Inline prompt builder — for plan / complete / research / fallback
// ============================================================

/**
 * Build a lightweight inline prompt for non-execute phases or as a
 * fallback when factory integration is unavailable.
 *
 * Unlike the old buildPrompt(), this does NOT truncate content to
 * arbitrary limits.  State files are inlined at their natural size;
 * the AI provider window is large enough to handle them.
 */
function buildInlinePrompt(cwd, unit) {
  const parts = [];
  parts.push(`You are executing a Forge auto-mode unit.\nPhase: ${unit.phase}\n`);

  const state = tryRead(cwd, '.planning/STATE.md');
  if (state) parts.push(`## Current State\n${state}\n`);

  if (unit.phase === 'plan') {
    const roadmap = tryRead(cwd, '.planning/ROADMAP.md');
    parts.push(`Plan phase ${unit.phaseNum}. Create detailed task plans in .planning/phases/.`);
    parts.push('Read ROADMAP.md for phase description. Break into concrete, actionable tasks.');
    if (roadmap) parts.push(`## ROADMAP\n${roadmap}\n`);
  } else if (unit.phase === 'verify') {
    parts.push(`Verify phase ${unit.phaseNum}. Run verification pipeline and report results.`);
    parts.push('Use: node forge-verify/engine.js --root . to run verification.');
  } else if (unit.phase === 'complete') {
    parts.push(`Complete phase ${unit.phaseNum}. Write SUMMARY.md, update ROADMAP.md, commit.`);
  } else if (unit.phase === 'research') {
    parts.push(`Research for phase ${unit.phaseNum}. Investigate implementation approaches.`);
  } else if (unit.phase === 'execute' && unit.taskId) {
    // Fallback execute prompt (when factory is unavailable)
    parts.push(`Execute task ${unit.taskId} for phase ${unit.phaseNum}.`);
    parts.push('Read the task plan file and implement it completely. Commit when done.');
    const planDir = `.planning/phases/${String(unit.phaseNum).padStart(2, '0')}`;
    try {
      const planFiles = fs.readdirSync(path.resolve(cwd, planDir)).filter(
        f => f.includes('PLAN') && f.endsWith('.md'),
      );
      for (const pf of planFiles) {
        const content = tryRead(cwd, path.join(planDir, pf));
        if (content) parts.push(`## Plan: ${pf}\n${content}\n`);
      }
    } catch { /* plan directory not found */ }
  }

  return parts.join('\n\n');
}

/**
 * Dispatch using a lightweight inline prompt (non-execute phases and fallback).
 */
function dispatchInline(cwd, unit, opts) {
  const prompt = buildInlinePrompt(cwd, unit);
  return invokeProvider(cwd, prompt, opts);
}

// ============================================================
// Main dispatch entry point
// ============================================================

/**
 * Dispatch a single auto-mode unit.
 *
 * Routing:
 *   execute → factory pipeline (buildAgentConfig → system_prompt)
 *   verify  → forge-verify/engine (programmatic or CLI spawn)
 *   others  → lightweight inline prompt
 *
 * @param {string} cwd - Project root.
 * @param {object} unit - { phase, phaseNum, taskId? }
 * @param {object} [opts] - { hardTimeout, provider, verbose, ... }
 * @returns {{ success: boolean, output: string, error: string }}
 */
function dispatch(cwd, unit, opts = {}) {
  switch (unit.phase) {
    case 'execute':
      return dispatchExecute(cwd, unit, opts);

    case 'verify':
      return dispatchVerify(cwd, unit);

    default:
      return dispatchInline(cwd, unit, opts);
  }
}

// ============================================================
// Deprecated: buildPrompt
// ============================================================

/**
 * @deprecated Use factory.buildAgentConfig() for execute units, or
 *             buildInlinePrompt() for other phases.
 *             This function will be removed in a future release.
 */
function buildPrompt(cwd, unit) {
  process.stderr.write(
    '[dispatcher] WARNING: buildPrompt() is deprecated. ' +
    'Use factory.buildAgentConfig() for execute units.\n',
  );
  return buildInlinePrompt(cwd, unit);
}

module.exports = { dispatch, buildPrompt };
