'use strict';

/**
 * requirements-pipeline.test.cjs
 *
 * End-to-end regression tests for the Forge requirements pipeline:
 *   REQUIREMENTS.md → ROADMAP.md → PLAN.md → execution
 *
 * Covers: frontmatter.cjs, core.cjs (isPlanComplete), assessor.js (parsePlan),
 *         cache.js (computeInputHash), config.js (loadConfig / validate).
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Module under test ────────────────────────────────────────────────────────
const fm = require(path.join(__dirname, '..', 'atos-forge', 'bin', 'lib', 'frontmatter.cjs'));
const core = require(path.join(__dirname, '..', 'atos-forge', 'bin', 'lib', 'core.cjs'));
const { parsePlan } = require(path.join(__dirname, '..', 'forge-assess', 'assessor.js'));
const { computeInputHash } = require(path.join(__dirname, '..', 'forge-agents', 'cache.js'));
const { loadConfig, validate } = require(path.join(__dirname, '..', 'forge-config', 'config.js'));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-pipeline-test-'));
}

function writeFile(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

// ============================================================
// 1. Frontmatter parsing tests
// ============================================================

describe('frontmatter — extractFrontmatter', () => {
  it('parses all standard plan fields from YAML', () => {
    const content = [
      '---',
      'phase: 5',
      'plan: auth-service',
      'type: feature',
      'wave: 2',
      'depends_on: [PLAN-db-setup]',
      'files_modified: [src/auth.js, src/token.js]',
      'autonomous: true',
      '---',
      '# Auth Service Plan',
    ].join('\n');

    const result = fm.extractFrontmatter(content);

    assert.equal(result.phase, 5);
    assert.equal(result.plan, 'auth-service');
    assert.equal(result.type, 'feature');
    assert.equal(result.wave, 2);
    assert.deepEqual(result.depends_on, ['PLAN-db-setup']);
    assert.deepEqual(result.files_modified, ['src/auth.js', 'src/token.js']);
    assert.equal(result.autonomous, true);
  });

  it('parses must_haves block with truths, key_links, and artifacts', () => {
    const content = [
      '---',
      'wave: 1',
      'must_haves:',
      '  truths:',
      '    - The API must return 200 on success',
      '    - Errors are JSON-formatted',
      '  key_links:',
      '    - https://example.com/spec',
      '  artifacts:',
      '    - dist/bundle.js',
      '    - docs/api.md',
      '---',
      'Body',
    ].join('\n');

    const truths = fm.parseMustHavesBlock(content, 'truths');
    const keyLinks = fm.parseMustHavesBlock(content, 'key_links');
    const artifacts = fm.parseMustHavesBlock(content, 'artifacts');

    assert.deepEqual(truths, ['The API must return 200 on success', 'Errors are JSON-formatted']);
    assert.deepEqual(keyLinks, ['https://example.com/spec']);
    assert.deepEqual(artifacts, ['dist/bundle.js', 'docs/api.md']);
  });

  it('parseMustHavesBlock returns [] for missing block name', () => {
    const content = '---\nwave: 1\nmust_haves:\n  truths:\n    - A truth\n---\nBody';
    const result = fm.parseMustHavesBlock(content, 'nonexistent_block');
    assert.deepEqual(result, []);
  });

  it('parseMustHavesBlock returns [] when there is no frontmatter', () => {
    const result = fm.parseMustHavesBlock('# Just markdown', 'truths');
    assert.deepEqual(result, []);
  });

  it('handles malformed YAML gracefully — returns empty object without throwing', () => {
    const content = '---\nwave: [bad: yaml: ::::\n---\nBody';
    // Must not throw
    let result;
    assert.doesNotThrow(() => { result = fm.extractFrontmatter(content); });
    assert.deepEqual(result, {});
  });

  it('handles empty frontmatter block', () => {
    const content = '---\n\n---\nBody';
    const result = fm.extractFrontmatter(content);
    // YAML.parse('') returns null → coerced to {}
    assert.deepEqual(result, {});
  });

  it('handles special characters — colons and hashes in string values', () => {
    const content = [
      '---',
      'title: "Fix: token refresh #123"',
      'url: "https://example.com/path"',
      '---',
      'Body',
    ].join('\n');

    const result = fm.extractFrontmatter(content);
    assert.equal(result.title, 'Fix: token refresh #123');
    assert.equal(result.url, 'https://example.com/path');
  });

  it('handles boolean and numeric types correctly', () => {
    const content = '---\nautonomous: false\nwave: 3\nretry_count: 0\n---\nBody';
    const result = fm.extractFrontmatter(content);
    assert.strictEqual(result.autonomous, false);
    assert.strictEqual(result.wave, 3);
    assert.strictEqual(result.retry_count, 0);
  });

  it('returns empty object when no frontmatter delimiter found', () => {
    const content = '# Just a heading\nSome body text without frontmatter.';
    const result = fm.extractFrontmatter(content);
    assert.deepEqual(result, {});
  });
});

// ============================================================
// 2. Plan completion detection tests  (core.isPlanComplete)
// ============================================================

describe('core — isPlanComplete', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns true for plan with Self-Check: PASSED and no test failures', () => {
    const summaryPath = writeFile(tmpDir, 'SUMMARY.md', [
      '---',
      'phase: 1',
      'tests_failed: 0',
      '---',
      '## Self-Check: PASSED',
      'All steps completed successfully.',
    ].join('\n'));

    assert.equal(core.isPlanComplete(summaryPath), true);
  });

  it('returns true for plan with inline Self-Check: PASSED (no heading ##)', () => {
    const summaryPath = writeFile(tmpDir, 'SUMMARY2.md', [
      '---',
      'phase: 1',
      '---',
      'Self-Check: PASSED — everything looks good.',
    ].join('\n'));

    assert.equal(core.isPlanComplete(summaryPath), true);
  });

  it('returns false for plan missing Self-Check: PASSED', () => {
    const summaryPath = writeFile(tmpDir, 'INCOMPLETE.md', [
      '---',
      'phase: 1',
      '---',
      '## Summary',
      'Work is ongoing.',
    ].join('\n'));

    assert.equal(core.isPlanComplete(summaryPath), false);
  });

  it('returns false for plan with tests_failed > 0 even if Self-Check line present', () => {
    const summaryPath = writeFile(tmpDir, 'FAILED.md', [
      '---',
      'phase: 1',
      'tests_failed: 3',
      '---',
      '## Self-Check: PASSED',
      'Tests had failures.',
    ].join('\n'));

    assert.equal(core.isPlanComplete(summaryPath), false);
  });

  it('returns false when the summary file does not exist', () => {
    assert.equal(core.isPlanComplete(path.join(tmpDir, 'nonexistent-SUMMARY.md')), false);
  });

  it('returns false for empty file', () => {
    const summaryPath = writeFile(tmpDir, 'EMPTY.md', '');
    assert.equal(core.isPlanComplete(summaryPath), false);
  });
});

// ============================================================
// 3. Assessor parsePlan tests
// ============================================================

describe('assessor — parsePlan', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('parses valid frontmatter and returns correct fields', () => {
    const planPath = writeFile(tmpDir, 'auth-PLAN.md', [
      '---',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/auth.js, src/middleware.js]',
      'autonomous: true',
      '---',
      '# Auth Plan',
      'Implement authentication middleware.',
    ].join('\n'));

    const plan = parsePlan(planPath);

    assert.equal(plan.frontmatter.wave, 1);
    assert.deepEqual(plan.frontmatter.depends_on, []);
    assert.deepEqual(plan.frontmatter.files_modified, ['src/auth.js', 'src/middleware.js']);
    assert.equal(plan.frontmatter.autonomous, true);
    assert.deepEqual(plan.files_modified, ['src/auth.js', 'src/middleware.js']);
  });

  it('parses <task> XML blocks', () => {
    const planPath = writeFile(tmpDir, 'task-PLAN.md', [
      '---',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      '---',
      '# Task Plan',
      '<task>',
      '<name>Setup database</name>',
      '<files>',
      'db/schema.sql',
      'db/migrations/001.sql',
      '</files>',
      '<action>Create the initial schema.</action>',
      '<verify>Run migration and check tables exist.</verify>',
      '</task>',
    ].join('\n'));

    const plan = parsePlan(planPath);

    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0].name, 'Setup database');
    assert.equal(plan.tasks[0].action, 'Create the initial schema.');
    assert.equal(plan.tasks[0].verify, 'Run migration and check tables exist.');
    assert.ok(plan.tasks[0].files.includes('db/schema.sql'));
    assert.ok(plan.tasks[0].files.includes('db/migrations/001.sql'));
  });

  it('parses <task type="auto"> with type attribute', () => {
    const planPath = writeFile(tmpDir, 'typed-PLAN.md', [
      '---',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      '---',
      '<task type="auto">',
      '<action>Do something automatically.</action>',
      '</task>',
    ].join('\n'));

    const plan = parsePlan(planPath);

    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0].type, 'auto');
  });

  it('parses <objective> XML tag', () => {
    const planPath = writeFile(tmpDir, 'obj-PLAN.md', [
      '---',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      '---',
      '<objective>Implement the token refresh mechanism.</objective>',
    ].join('\n'));

    const plan = parsePlan(planPath);

    assert.equal(plan.objective, 'Implement the token refresh mechanism.');
  });

  it('parses ## Objective markdown heading as objective fallback', () => {
    const planPath = writeFile(tmpDir, 'mdobj-PLAN.md', [
      '---',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      '---',
      '## Objective',
      'Build the reporting dashboard.',
      '',
      '## Tasks',
    ].join('\n'));

    const plan = parsePlan(planPath);

    assert.ok(plan.objective.includes('Build the reporting dashboard.'));
  });

  it('handles plan without frontmatter gracefully', () => {
    const planPath = writeFile(tmpDir, 'nofm-PLAN.md', [
      '# Plan Without Frontmatter',
      'Some task description.',
    ].join('\n'));

    let plan;
    assert.doesNotThrow(() => { plan = parsePlan(planPath); });

    // No frontmatter block → frontmatter stays as empty object, no crash
    assert.equal(typeof plan.frontmatter, 'object');
    assert.ok(plan.frontmatter !== null);
    // files_modified defaults to []
    assert.deepEqual(plan.files_modified, []);
    // all_files contains at least the union (empty when no tasks either)
    assert.ok(Array.isArray(plan.all_files));
  });

  it('merges files_modified from frontmatter and <task> blocks into all_files', () => {
    const planPath = writeFile(tmpDir, 'merge-PLAN.md', [
      '---',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/index.js]',
      'autonomous: true',
      '---',
      '<task>',
      '<files>',
      'src/helper.js',
      '</files>',
      '<action>Help.</action>',
      '</task>',
    ].join('\n'));

    const plan = parsePlan(planPath);

    assert.ok(plan.all_files.includes('src/index.js'));
    assert.ok(plan.all_files.includes('src/helper.js'));
  });

  it('handles malformed YAML frontmatter without crashing', () => {
    const planPath = writeFile(tmpDir, 'bad-fm-PLAN.md', [
      '---',
      'wave: [unclosed',
      '---',
      '# Plan',
    ].join('\n'));

    let plan;
    assert.doesNotThrow(() => { plan = parsePlan(planPath); });
    // Defaults should be applied when YAML parse fails
    assert.equal(plan.frontmatter.wave, 1);
  });
});

// ============================================================
// 4. Cache hash computation tests
// ============================================================

describe('cache — computeInputHash', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    // Minimal .forge structure (files missing → hash uses 'none' sentinels)
    fs.mkdirSync(path.join(tmpDir, '.forge', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.forge', 'session'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.forge', 'knowledge'), { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('same inputs produce the same hash', () => {
    const planPath = writeFile(tmpDir, 'plan.md', '# Test Plan\nDo something.');
    const h1 = computeInputHash(planPath, tmpDir, {});
    const h2 = computeInputHash(planPath, tmpDir, {});
    assert.ok(h1, 'hash should not be null');
    assert.equal(h1, h2);
    assert.equal(h1.length, 64); // SHA-256 hex = 64 chars
  });

  it('different plan content produces different hash', () => {
    const planPath = writeFile(tmpDir, 'plan.md', '# Plan v1');
    const h1 = computeInputHash(planPath, tmpDir, {});

    writeFile(tmpDir, 'plan.md', '# Plan v2 — different content');
    const h2 = computeInputHash(planPath, tmpDir, {});

    assert.notEqual(h1, h2);
  });

  it('returns null when plan file does not exist', () => {
    const result = computeInputHash(path.join(tmpDir, 'nonexistent.md'), tmpDir, {});
    assert.equal(result, null);
  });

  it('missing optional files (.forge/graph.db etc.) are handled gracefully', () => {
    // No graph.db, no system-graph.db, no knowledge, no ledger → still returns a hash
    const planPath = writeFile(tmpDir, 'plan.md', '# Minimal Plan');
    const h = computeInputHash(planPath, tmpDir, {});
    assert.ok(h, 'should return a hash even when optional files are absent');
    assert.equal(typeof h, 'string');
  });

  it('previousFindings changes produce a different hash', () => {
    const planPath = writeFile(tmpDir, 'plan.md', '# Plan');
    const h1 = computeInputHash(planPath, tmpDir, {});
    const h2 = computeInputHash(planPath, tmpDir, { previousFindings: { wave: 1, errors: ['E001'] } });
    assert.ok(h1);
    assert.ok(h2);
    assert.notEqual(h1, h2);
  });

  it('different previousFindings values produce different hashes', () => {
    const planPath = writeFile(tmpDir, 'plan.md', '# Plan');
    const h1 = computeInputHash(planPath, tmpDir, { previousFindings: { wave: 1 } });
    const h2 = computeInputHash(planPath, tmpDir, { previousFindings: { wave: 2 } });
    assert.notEqual(h1, h2);
  });
});

// ============================================================
// 5. Config validation tests
// ============================================================

describe('config — validate', () => {
  it('default config passes validation', () => {
    const { config } = loadConfig(os.tmpdir()); // tmpdir has no .forge/config.json
    const result = validate(config);
    assert.equal(result.valid, true, `Expected valid, but got errors: ${result.errors.join(', ')}`);
    assert.deepEqual(result.errors, []);
  });

  it('valid custom config passes validation', () => {
    const config = {
      execution: {
        mode: 'autonomous',
        container_backend: 'worktree',
        context_budget: 150000,
        safety_margin: 0.25,
        assessment_threshold: 0.75,
        max_fix_loops: 5,
        overhead_per_subtask: 4000,
        min_action_budget: 10000,
        chars_per_token: 4,
        budget_ceiling_usd: null,
        auto_split: true,
      },
      containers: {
        max_concurrent: 'auto',
        max_memory_per_container: '2g',
        max_cpu_per_container: 1.0,
        max_total_memory: 'auto',
        max_total_cpu: 'auto',
        timeout_seconds: 300,
        network_access: false,
        cleanup_on_exit: true,
        image_prefix: 'forge-agent',
      },
      agents: {
        factory_enabled: true,
        default_archetype: 'general',
        provider: 'auto',
        active_profile: 'balanced',
        model_profiles: { quality: 'opus', balanced: 'sonnet', budget: 'haiku' },
      },
      verification: {
        layers: {
          structural: true,
          type_check: true,
          interface_contracts: false,
          dependency_analysis: true,
          tests: true,
          behavioral: false,
          contract: true,
          architectural: false,
          browser: false,
          key_links: true,
        },
        auto_fix: true,
        max_fix_loops: 3,
        test_command: null,
        type_check_command: null,
        test_timeout: 300,
      },
      knowledge: {
        enabled: true,
        auto_promote: false,
        max_entries: 100,
        promote_severity_threshold: 'high',
      },
      impact_analysis: {
        enabled: true,
        auto_detect: true,
        max_depth: 3,
        scope_threshold: 2,
      },
      session: {
        ledger_enabled: true,
        ledger_max_tokens: 5000,
        auto_compact: true,
        archive_on_phase_complete: false,
      },
      git: {
        atomic_commits: true,
        commit_prefix: '',
        branching_strategy: 'none',
        sign_commits: false,
      },
      graph: {
        enabled: true,
        snapshot_retention: 10,
        ignore_patterns: ['node_modules'],
      },
      system: {
        workers: 'auto',
        discovery_depth: 2,
        default_delivery: 'local',
        ignore_repos: [],
      },
    };

    const result = validate(config);
    assert.equal(result.valid, true, `Expected valid, got: ${result.errors.join(', ')}`);
  });

  it('invalid type for execution.context_budget fails validation', () => {
    const config = {
      execution: { context_budget: 'not-a-number' },
    };
    const result = validate(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('execution.context_budget')));
  });

  it('out-of-range assessment_threshold fails validation', () => {
    const config = {
      execution: { assessment_threshold: 1.5 }, // must be 0–1
    };
    const result = validate(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('assessment_threshold')));
  });

  it('invalid execution.mode enum fails validation', () => {
    const config = {
      execution: { mode: 'turbo-mode' },
    };
    const result = validate(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('execution.mode')));
  });

  it('invalid agents.active_profile enum fails validation', () => {
    const config = {
      agents: { active_profile: 'ultra' },
    };
    const result = validate(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('agents.active_profile')));
  });

  it('non-boolean verification layer fails validation', () => {
    const config = {
      verification: {
        layers: {
          structural: 'yes', // should be boolean
        },
      },
    };
    const result = validate(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('verification.layers.structural')));
  });

  it('missing optional fields do not fail validation', () => {
    // Minimal config — most optional fields absent
    const config = {
      execution: { context_budget: 200000 },
    };
    const result = validate(config);
    assert.equal(result.valid, true, `Should be valid, got: ${result.errors.join(', ')}`);
  });

  it('invalid knowledge.promote_severity_threshold enum fails', () => {
    const config = {
      knowledge: { promote_severity_threshold: 'extreme' },
    };
    const result = validate(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('knowledge.promote_severity_threshold')));
  });

  it('negative execution.max_fix_loops fails validation', () => {
    const config = {
      execution: { max_fix_loops: -1 },
    };
    const result = validate(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('execution.max_fix_loops')));
  });

  it('graph.ignore_patterns as non-array fails validation', () => {
    const config = {
      graph: { ignore_patterns: 'node_modules' }, // should be array
    };
    const result = validate(config);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('graph.ignore_patterns')));
  });
});

// ============================================================
// 6. Pipeline integration: frontmatter → isPlanComplete round-trip
// ============================================================

describe('pipeline integration — plan lifecycle', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('a parsed plan with YAML frontmatter can be checked for completion', () => {
    // 1. Write a plan
    const planPath = writeFile(tmpDir, 'feature-PLAN.md', [
      '---',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/feature.js]',
      'autonomous: true',
      '---',
      '# Feature Plan',
      '<objective>Implement feature X.</objective>',
      '<task>',
      '<files>',
      'src/feature.js',
      '</files>',
      '<action>Build the feature.</action>',
      '</task>',
    ].join('\n'));

    // 2. Parse it with assessor
    const plan = parsePlan(planPath);
    assert.equal(plan.frontmatter.wave, 1);
    assert.ok(plan.all_files.includes('src/feature.js'));

    // 3. Write a matching SUMMARY before completion
    const summaryPathIncomplete = writeFile(tmpDir, 'feature-SUMMARY.md', [
      '---',
      'phase: 1',
      '---',
      '## Work in progress',
    ].join('\n'));

    assert.equal(core.isPlanComplete(summaryPathIncomplete), false);

    // 4. Update summary to mark complete
    const summaryPathComplete = writeFile(tmpDir, 'feature-SUMMARY-done.md', [
      '---',
      'phase: 1',
      'tests_failed: 0',
      '---',
      '## Self-Check: PASSED',
      'All steps done.',
    ].join('\n'));

    assert.equal(core.isPlanComplete(summaryPathComplete), true);
  });

  it('cache hash changes when plan frontmatter changes', () => {
    // Setup minimal .forge structure
    fs.mkdirSync(path.join(tmpDir, '.forge', 'agents'), { recursive: true });

    const planPath = writeFile(tmpDir, 'plan.md', [
      '---',
      'wave: 1',
      'depends_on: []',
      'files_modified: [a.js]',
      'autonomous: true',
      '---',
      '# Plan A',
    ].join('\n'));

    const h1 = computeInputHash(planPath, tmpDir, {});

    // Change frontmatter (new dependency added)
    writeFile(tmpDir, 'plan.md', [
      '---',
      'wave: 1',
      'depends_on: [PLAN-setup]',
      'files_modified: [a.js]',
      'autonomous: true',
      '---',
      '# Plan A',
    ].join('\n'));

    const h2 = computeInputHash(planPath, tmpDir, {});

    assert.ok(h1);
    assert.ok(h2);
    assert.notEqual(h1, h2, 'Hash should change when frontmatter depends_on changes');
  });
});
