#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================
// Patch Collection from Container Output
// ============================================================

/**
 * Collect git patches from a container's output directory.
 *
 * Containers write their changes as:
 *   /output/patches/        — One .patch file per logical change
 *   /output/result.json     — Agent result (status, learnings, warnings)
 *   /output/stdout.log      — Container stdout
 *   /output/stderr.log      — Container stderr
 *
 * @param {string} outputDir - Host path to the container's output directory.
 * @returns {CollectionResult}
 */
function collectPatches(outputDir) {
  const patchDir = path.join(outputDir, 'patches');
  const resultPath = path.join(outputDir, 'result.json');
  const stdoutPath = path.join(outputDir, 'stdout.log');
  const stderrPath = path.join(outputDir, 'stderr.log');

  const result = {
    patches: [],
    agentResult: null,
    stdout: '',
    stderr: '',
    errors: [],
  };

  // Collect patches
  if (fs.existsSync(patchDir)) {
    const files = fs.readdirSync(patchDir)
      .filter(f => f.endsWith('.patch'))
      .sort();
    for (const file of files) {
      const patchPath = path.join(patchDir, file);
      try {
        const content = fs.readFileSync(patchPath, 'utf8');
        if (content.trim().length > 0) {
          result.patches.push({ name: file, path: patchPath, content });
        }
      } catch (err) {
        result.errors.push(`Failed to read patch ${file}: ${err.message}`);
      }
    }
  }

  // Collect agent result
  if (fs.existsSync(resultPath)) {
    try {
      result.agentResult = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    } catch (err) {
      result.errors.push(`Failed to parse result.json: ${err.message}`);
    }
  }

  // Collect logs
  try { result.stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : ''; } catch { /* ignore */ }
  try { result.stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : ''; } catch { /* ignore */ }

  return result;
}

// ============================================================
// Pre-Apply Conflict Detection
// ============================================================

/**
 * Extract the set of files modified by a unified diff / git patch.
 *
 * Parses `diff --git a/<src> b/<dst>` headers and returns the destination
 * (b/) path for every changed file. Works with standard `git diff` output
 * as well as patches produced by `git format-patch`.
 *
 * @param {string} diffContent - Raw unified diff / patch text.
 * @returns {string[]} Unique list of destination file paths.
 */
function extractPatchFiles(diffContent) {
  const files = new Set();
  const regex = /^diff --git a\/(.*?) b\/(.*?)$/gm;
  let match;
  while ((match = regex.exec(diffContent)) !== null) {
    files.add(match[2]); // use b/ path (destination)
  }
  return [...files];
}

/**
 * Detect files touched by more than one patch in the same wave.
 *
 * Call this before applying a batch of patches collected from parallel
 * agents. If any file appears in multiple patches the wave has a conflict:
 * applying the patches sequentially will silently produce merge artifacts
 * or cause `git apply` to fail on the second patch for that file.
 *
 * Each element of `patches` must have at least one of:
 *   - `content`  — raw diff string (preferred)
 *   - `diff`     — alias for content
 *
 * And at least one of:
 *   - `taskId`   — agent/task identifier
 *   - `id`       — alias
 *   - `name`     — patch file name used as fallback label
 *
 * @param {Array<{ content?: string, diff?: string, taskId?: string, id?: string, name?: string }>} patches
 * @returns {Array<{ file: string, patches: string[] }>} Conflicts — empty array means no conflicts.
 */
function detectPatchConflicts(patches) {
  /** @type {Map<string, string[]>} file → [patchId, ...] */
  const fileMap = new Map();

  for (const patch of patches) {
    const diffContent = patch.content || patch.diff || '';
    const patchId = patch.taskId || patch.id || patch.name || 'unknown';
    const files = extractPatchFiles(diffContent);
    for (const file of files) {
      if (!fileMap.has(file)) fileMap.set(file, []);
      fileMap.get(file).push(patchId);
    }
  }

  const conflicts = [];
  for (const [file, patchIds] of fileMap) {
    if (patchIds.length > 1) {
      conflicts.push({ file, patches: patchIds });
    }
  }
  return conflicts;
}

// ============================================================
// Patch Application
// ============================================================

/**
 * Apply collected patches to the main repo working tree.
 *
 * Runs a pre-apply conflict guard: if two or more patches in the batch
 * modify the same file an error is thrown **before** any patch is applied,
 * keeping the working tree clean.
 *
 * @param {string} repoRoot - Main repository root.
 * @param {object[]} patches - Array of { name, content } from collectPatches().
 * @param {{ dryRun?: boolean, check?: boolean, skipConflictCheck?: boolean }} opts
 * @returns {{ applied: string[], failed: string[], skipped: string[] }}
 */
function applyPatches(repoRoot, patches, opts = {}) {
  const applied = [];
  const failed = [];
  const skipped = [];

  // Pre-apply conflict guard — bail out before touching any file.
  if (!opts.skipConflictCheck) {
    const conflicts = detectPatchConflicts(patches);
    if (conflicts.length > 0) {
      const detail = conflicts
        .map(c => `  ${c.file}: touched by ${c.patches.join(', ')}`)
        .join('\n');
      throw new Error(
        `Patch conflict detected — same files modified by multiple agents:\n${detail}`
      );
    }
  }

  for (const patch of patches) {
    // First check if patch applies cleanly
    try {
      execSync(`git apply --check --directory=. -`, {
        cwd: repoRoot,
        input: patch.content,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
    } catch {
      // Patch won't apply cleanly — try with 3-way merge
      try {
        execSync(`git apply --check --3way --directory=. -`, {
          cwd: repoRoot,
          input: patch.content,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30000,
        });
      } catch {
        failed.push(patch.name);
        continue;
      }
    }

    if (opts.dryRun || opts.check) {
      skipped.push(patch.name);
      continue;
    }

    // Apply the patch
    try {
      execSync(`git apply --3way --directory=. -`, {
        cwd: repoRoot,
        input: patch.content,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
      applied.push(patch.name);
    } catch {
      failed.push(patch.name);
    }
  }

  return { applied, failed, skipped };
}

/**
 * Extract learnings (warnings, discoveries) from an agent result for ledger integration.
 *
 * @param {object} agentResult - Parsed result.json from container.
 * @returns {{ warnings: object[], discoveries: object[] }}
 */
function extractLearnings(agentResult) {
  const warnings = [];
  const discoveries = [];

  if (!agentResult) return { warnings, discoveries };

  // Agent-reported warnings
  if (Array.isArray(agentResult.warnings)) {
    for (const w of agentResult.warnings) {
      warnings.push({
        warning: typeof w === 'string' ? w : w.message || w.warning || JSON.stringify(w),
        source: `container:${agentResult.task_id || 'unknown'}`,
        severity: w.severity || 'medium',
      });
    }
  }

  // Agent-reported discoveries
  if (Array.isArray(agentResult.discoveries)) {
    for (const d of agentResult.discoveries) {
      discoveries.push({
        discovery: typeof d === 'string' ? d : d.message || d.discovery || JSON.stringify(d),
        source: `container:${agentResult.task_id || 'unknown'}`,
      });
    }
  }

  // Extract from agent notes/learnings field (alternative format)
  if (agentResult.learnings) {
    const l = agentResult.learnings;
    if (Array.isArray(l.warnings)) {
      for (const w of l.warnings) {
        warnings.push({
          warning: typeof w === 'string' ? w : w.message || JSON.stringify(w),
          source: `container:${agentResult.task_id || 'unknown'}`,
          severity: 'medium',
        });
      }
    }
    if (Array.isArray(l.discoveries)) {
      for (const d of l.discoveries) {
        discoveries.push({
          discovery: typeof d === 'string' ? d : d.message || JSON.stringify(d),
          source: `container:${agentResult.task_id || 'unknown'}`,
        });
      }
    }
  }

  return { warnings, discoveries };
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  collectPatches,
  applyPatches,
  extractLearnings,
  detectPatchConflicts,
  extractPatchFiles,
};
