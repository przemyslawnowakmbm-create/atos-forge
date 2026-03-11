'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function buildPrompt(cwd, unit) {
  const parts = [];
  parts.push(`You are executing a Forge auto-mode unit.\nPhase: ${unit.phase}\n`);

  // Pre-inline key context files
  const tryRead = (p) => { try { return fs.readFileSync(path.resolve(cwd, p), 'utf8'); } catch { return null; } };

  const state = tryRead('.planning/STATE.md');
  if (state) parts.push(`## Current State\n${state.slice(0, 2000)}\n`);

  if (unit.phase === 'execute' && unit.taskId) {
    parts.push(`Execute task ${unit.taskId} for phase ${unit.phaseNum}.`);
    parts.push('Read the task plan file and implement it completely. Commit when done.');
    // Try to inline task plan
    const planDir = `.planning/phases/${String(unit.phaseNum).padStart(2, '0')}`;
    try {
      const planFiles = fs.readdirSync(path.resolve(cwd, planDir)).filter(f => f.includes('PLAN') && f.endsWith('.md'));
      for (const pf of planFiles) {
        const content = tryRead(path.join(planDir, pf));
        if (content) parts.push(`## Plan: ${pf}\n${content.slice(0, 4000)}\n`);
      }
    } catch {}
  } else if (unit.phase === 'plan') {
    parts.push(`Plan phase ${unit.phaseNum}. Create detailed task plans in .planning/phases/.`);
    parts.push('Read ROADMAP.md for phase description. Break into concrete, actionable tasks.');
  } else if (unit.phase === 'verify') {
    parts.push(`Verify phase ${unit.phaseNum}. Run verification pipeline and report results.`);
    parts.push('Use: node forge-verify/engine.js --root . to run verification.');
  } else if (unit.phase === 'complete') {
    parts.push(`Complete phase ${unit.phaseNum}. Write SUMMARY.md, update ROADMAP.md, commit.`);
  } else if (unit.phase === 'research') {
    parts.push(`Research for phase ${unit.phaseNum}. Investigate implementation approaches.`);
  }

  return parts.join('\n\n');
}

function dispatch(cwd, unit, opts = {}) {
  const prompt = buildPrompt(cwd, unit);
  const timeout = (opts.hardTimeout || 600) * 1000;

  // Write prompt to temp file to avoid shell escaping issues
  const tmpPrompt = path.join(cwd, '.forge', 'session', '_auto_prompt.md');
  try {
    const dir = path.dirname(tmpPrompt);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPrompt, prompt);
  } catch {}

  try {
    const result = execSync(
      `claude --print --dangerously-skip-permissions -p "${tmpPrompt}"`,
      { cwd, encoding: 'utf8', timeout, maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    try { fs.unlinkSync(tmpPrompt); } catch {}
    return { success: true, output: result };
  } catch (e) {
    try { fs.unlinkSync(tmpPrompt); } catch {}
    return { success: false, error: e.message || 'unknown error', output: e.stdout || '' };
  }
}

module.exports = { dispatch, buildPrompt };
