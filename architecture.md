# Forge — Remediation Architecture

**Analysis Date:** 2026-04-23
**Scope:** 36 fixes across 5 execution phases, organized for maximum parallel execution
**Objective:** Fix all critical pipeline bugs — parser, contract propagation, verification, agent factory, auto mode, token efficiency

---

## Pattern Overview

**Pattern:** Surgical multi-module remediation of a monolithic CLI tool (Atos Forge)
**Key Characteristics:**
- 10 sibling engine modules under one root, each with independent responsibilities
- Fixes touch independent files across modules — high parallelism potential
- Strict dependency chain: YAML parser (Fix 1) unblocks ~10 downstream fixes
- Each fix has defined acceptance criteria — verification commands that must pass
- Runtime: Node.js CJS, Database: SQLite (better-sqlite3), no external services

---

## Layers

### Layer 1: Plan Parsing (forge-assess/)
- **Purpose:** Parse PLAN.md files — frontmatter, tasks, objectives — into structured objects consumed by factory, splitter, and verifier
- **Contains:** `forge-assess/assessor.js` (parsePlan), `forge-assess/splitter.js` (splitPlan, buildSubPlan)
- **Depends on:** nothing (entry point for the pipeline)
- **Used by:** Layer 2 (Agent Factory), Layer 3 (Verification), Layer 4 (Orchestration)
- **Current bugs:** Regex-based YAML parsing drops must_haves/requirements (Fix 1). Task regex misses `<task type="...">` attributes (Fix 2). `<objective>` XML tags ignored (Fix 2). Sub-plans lose parent contract (Fix 4). Test mode pollutes user src/ (Fix 8).

### Layer 2: Agent Factory (forge-agents/)
- **Purpose:** Build specialized agent configurations — system prompts, context packages, verification steps — from parsed plans
- **Contains:** `forge-agents/factory.js` (buildAgentConfig, composeSystemPrompt, extractSessionContext), `forge-agents/cache.js` (computeInputHash), `forge-agents/agent-output-schema.js`, `forge-agents/agent-registry.js`
- **Depends on:** Layer 1 (parsed plan data)
- **Used by:** Layer 4 (Orchestration), Layer 5 (Auto Mode)
- **Current bugs:** System prompt has zero plan contract (Fix 5). Cache key misses planning docs and factory version (Fix 10). Wave-to-wave findings bridge missing (Fix 9). Agent output not JSON-Schema validated (Fix 14). Ledger context uncapped (Fix 32). No system prompt scaffold cache (Fix 33).

### Layer 3: Verification Pipeline (forge-verify/, atos-forge/bin/lib/verify.cjs)
- **Purpose:** Multi-layer verification of agent work — structural, type, interface, dependency, tests, behavioral, contract, architectural
- **Contains:** `forge-verify/engine.js` (9-layer verify), `forge-verify/loop.js` (auto-fix loop), `atos-forge/bin/lib/verify.cjs` (CLI verify commands)
- **Depends on:** Layer 1 (plan parsing for must_haves), Layer 2 (agent configs for verification steps)
- **Used by:** Layer 4 (post-wave/phase verification)
- **Current bugs:** No KEY_LINKS layer (Fix 6). Key-link false positive via target fallback (Fix 3). Behavioral must_check uses trivial keyword heuristic (Fix 7). Per-wave fast verifier not wired (Fix 21).

### Layer 4: Orchestration (forge-containers/, atos-forge/workflows/, atos-forge/bin/lib/)
- **Purpose:** Execute agent waves — patch collection, conflict detection, wave-level verification, session management
- **Contains:** `forge-containers/worktree-orchestrator.js`, `forge-containers/orchestrator.js`, `forge-containers/patch-collector.js`, `atos-forge/workflows/execute-phase.md`, `atos-forge/workflows/plan-phase.md`, `atos-forge/bin/lib/core.cjs`, `atos-forge/bin/lib/init.cjs`
- **Depends on:** Layers 1-3
- **Used by:** Layer 5 (Auto Mode), User commands
- **Current bugs:** No patch DAG ordering or conflict guard (Fix 11). No plan completion integrity check (Fix 16). Codebase docs never loaded (Fix 24). Bulk file inclusion instead of summary-then-load (Fix 31). Revision/fix agents not cache-bypassed (Fix 12).

### Layer 5: Auto Mode (forge-auto/)
- **Purpose:** Autonomous execution — state machine drives research, plan, execute, verify cycle without user interaction
- **Contains:** `forge-auto/auto.js`, `forge-auto/dispatcher.js`, `forge-auto/state-machine.js`
- **Depends on:** Layers 1-4 (should use full factory pipeline)
- **Used by:** `/forge-auto` command
- **Current bugs:** Bypasses factory entirely — builds minimal ~1500-token prompts with no graph, contract, or verification (Fix 17).

### Layer 6: Session & Infrastructure (forge-session/, hooks/)
- **Purpose:** Session memory, crash recovery, context monitoring, knowledge persistence
- **Contains:** `forge-session/ledger.js`, `forge-session/crash-recovery.js`, `hooks/forge-context-monitor.js`
- **Depends on:** nothing (infrastructure layer)
- **Used by:** All other layers
- **Current bugs:** No ledger write lock for parallel agents (Fix 23). Crash-recovery PID check fails across reboots (Fix 26). Context-monitor silently exits when statusline stale (Fix 27).

### Layer 7: Agent Definitions & Workflows (agents/, atos-forge/workflows/)
- **Purpose:** Agent prompt definitions, workflow orchestration scripts, reference documents
- **Contains:** `agents/forge-executor.md`, `agents/forge-planner.md`, `agents/forge-verifier.md`, `agents/forge-plan-checker.md`, `agents/forge-project-researcher.md`, `agents/forge-phase-researcher.md`, workflow .md files, reference .md files
- **Depends on:** nothing (static definitions)
- **Used by:** Layers 2, 4, 5
- **Current bugs:** Executor Rule 1 allows test modification (Fix 20). Debug template undefined (Fix 15). No forge-test-author agent (Fix 19). No forge-code-reviewer agent (Fix 13). No forge-research-checker agent (Fix 18). Prompts are oversized (Fixes 28-30). Workflows use general-purpose subagent_type (Fix 34). No WebSearch budget (Fix 35). add-tests uses classifier not truths (Fix 22). No research provenance/refresh (Fix 25).

### Layer 8: Testing (tests/)
- **Purpose:** Regression tests ensuring pipeline correctness
- **Contains:** `tests/*.test.cjs`, `tests/helpers.cjs`
- **Depends on:** Layers 1-7 (tests verify all module behavior)
- **Used by:** CI, verification gates
- **Current bugs:** No multi-runtime conversion tests (Fix 36).

---

## Data Flow

### Current (broken) flow:
1. User creates PLAN.md with YAML frontmatter containing must_haves, requirements, truths, key_links
2. `assessor.js::parsePlan` reads it with REGEX — drops must_haves, requirements, truths, key_links (BUG)
3. `factory.js::buildAgentConfig` builds agent with NO plan contract in system prompt (BUG)
4. Agent executes without knowing requirements or wiring expectations
5. `engine.js::verify` runs 9 layers but has NO key-link verification layer (BUG)
6. Broken implementations pass verification as PASS (BUG)

### Target (fixed) flow:
1. User creates PLAN.md with YAML frontmatter
2. `assessor.js::parsePlan` reads it with `YAML.parse` — preserves ALL frontmatter fields
3. `factory.js::composeSystemPrompt` injects full Plan Contract section (truths, key_links, artifacts, requirements)
4. Agent executes with clear contract — knows what wiring must exist
5. `engine.js::verify` runs KEY_LINKS layer — catches broken wiring before marking PASS
6. Broken implementations correctly FAIL verification

---

## Key Abstractions

### must_haves Contract
- **Purpose:** Machine-verifiable acceptance criteria embedded in plan frontmatter
- **Examples:** `truths` (user-observable behaviors), `key_links` (file-to-file wiring), `artifacts` (required files with properties)
- **Pattern:** Declarative contract — written once in plan, propagated to agents, verified by engine

### Wave-based Execution
- **Purpose:** Parallel agent execution with sequential dependency gates
- **Examples:** Wave 1 agents run in parallel, Wave 2 starts only after Wave 1 verified
- **Pattern:** DAG scheduling with bin-packing

### Agent Cache
- **Purpose:** Avoid re-running 7-step factory pipeline when inputs unchanged
- **Examples:** SHA-256 hash of plan + graph + knowledge + ledger → cache hit = instant reuse
- **Pattern:** Content-addressed cache with invalidation on input change

---

## Entry Points

### Primary Entry (parser — everything starts here):
- **Location:** `forge-assess/assessor.js::parsePlan` (line 89)
- **Triggers:** Every plan-phase, execute-phase, auto-mode, and verify command
- **Responsibilities:** Parse YAML frontmatter, extract tasks, extract objective

### Agent Factory:
- **Location:** `forge-agents/factory.js::buildAgentConfig` (line ~1200)
- **Triggers:** execute-phase workflow, auto-mode dispatch
- **Responsibilities:** Build complete agent config from parsed plan

### Verification Engine:
- **Location:** `forge-verify/engine.js::verify` (line ~1550)
- **Triggers:** Post-wave checks, end-of-phase verification, manual verify commands
- **Responsibilities:** Run all verification layers, report pass/fail

---

## Implementation Phases

### PHASE 1: Foundation Parser (Sequential — must complete first)
**Rationale:** Fix 1 is the critical path — 10+ downstream fixes depend on YAML-parsed frontmatter being available. No parallelism possible here.

#### Task 1.1: Install yaml npm package and rewrite parsePlan (Fix 1)

**Files:**
- `forge-assess/package.json` — CREATE with yaml dependency
- `forge-assess/assessor.js` — MODIFY parsePlan function (lines 89-160)
- `atos-forge/bin/lib/frontmatter.cjs` — MODIFY parseMustHavesBlock and extractFrontmatter (lines 7-218)
- `package.json` — ADD yaml to root dependencies

**Changes in `forge-assess/assessor.js::parsePlan` (lines 93-124):**
Replace the hand-rolled regex block (waveMatch, depsMatch, autoMatch, files_modified extraction) with:
```js
const YAML = require('yaml');
// ... inside parsePlan, after fmMatch:
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
if (fmMatch) {
  let parsed = {};
  try {
    parsed = YAML.parse(fmMatch[1]) || {};
  } catch (e) {
    console.error(`[parsePlan] YAML error in ${planPath}: ${e.message}`);
    parsed = {};
  }
  plan.frontmatter = {
    wave: parsed.wave ?? 1,
    depends_on: Array.isArray(parsed.depends_on) ? parsed.depends_on : [],
    autonomous: parsed.autonomous !== false,
    ...parsed,   // expose ALL fields: phase, plan, type, requirements, must_haves, has_tests, service, repo, role, etc.
  };
  plan.files_modified = Array.isArray(parsed.files_modified)
    ? parsed.files_modified
    : (typeof parsed.files_modified === 'string' ? [parsed.files_modified] : []);
}
```

**Changes in `atos-forge/bin/lib/frontmatter.cjs`:**
Replace the rigid indent parser in `parseMustHavesBlock` with:
```js
const YAML = require('yaml');
function parseMustHavesBlock(content, blockName) {
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!fmMatch) return [];
  let parsed;
  try { parsed = YAML.parse(fmMatch[1]) || {}; } catch { return []; }
  const block = parsed?.must_haves?.[blockName];
  return Array.isArray(block) ? block : [];
}
```
Update `extractFrontmatter` to use `YAML.parse` and return the full parsed object.

**Create `forge-assess/package.json`:**
```json
{ "name": "@atos-forge/assess", "version": "0.1.0", "private": true, "main": "assessor.js", "dependencies": { "yaml": "^2.6.0" } }
```

**Verification:**
```bash
cd forge-assess && npm install --no-audit --no-fund
node -e "const a=require('./forge-assess/assessor.js'); const p=a.parsePlan('test-fixtures/plan-with-must-haves.md'); console.log(Object.keys(p.frontmatter).includes('must_haves'));"
# Must print: true
```

---

### PHASE 2: Core Independent Fixes (All Parallel — no cross-dependencies)
**Rationale:** These 13 fixes touch completely independent files. Each can be implemented by a separate agent session without conflicts.

#### Task 2.1: Parse task type attributes and objective tags (Fix 2)

**Files:** `forge-assess/assessor.js` — lines 127-157
**Depends on:** Phase 1 (YAML parser must be in place)

**Change 1 — Task regex (line 127):**
Replace `/<task>([\s\S]*?)<\/task>/g` with `/<task\b[^>]*>([\s\S]*?)<\/task>/g`

Inside the task-parsing loop (lines 129-146), add type and name extraction:
```js
const typeMatch = taskMatch[0].match(/<task\b[^>]*\btype="([^"]+)"/);
const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);
plan.tasks.push({
  type: typeMatch ? typeMatch[1] : 'auto',
  name: nameMatch ? nameMatch[1].trim() : '',
  files, action, verify, done,
});
```

**Change 2 — Objective (line 156):**
Replace:
```js
const objMatch = raw.match(/##\s*Objective\s*\n([\s\S]*?)(?=\n##|\n<|\Z)/);
plan.objective = objMatch ? objMatch[1].trim() : '';
```
With:
```js
const objTagMatch = raw.match(/<objective>([\s\S]*?)<\/objective>/);
const objMdMatch  = raw.match(/##\s*Objective\s*\n([\s\S]*?)(?=\n##|\n<|$)/);
plan.objective = (objTagMatch?.[1] || objMdMatch?.[1] || '').trim();
```

**Verification:**
```bash
node -e "const a=require('./forge-assess/assessor.js'); const p=a.parsePlan('test-fixtures/plan-with-tasks.md'); console.log({tasks: p.tasks.length, types: p.tasks.map(t=>t.type), objLen: p.objective.length});"
# tasks > 0, types includes 'auto', objLen > 0
```

#### Task 2.2: Key-link patterns must match in source only (Fix 3)

**Files:** `atos-forge/bin/lib/verify.cjs` — lines 260-274
**Depends on:** nothing

**Change:** Remove the target fallback (lines 267-272). Replace the entire pattern-matching else-if block:
```js
} else if (link.pattern) {
  try {
    const regex = new RegExp(link.pattern);
    if (regex.test(sourceContent)) {
      check.verified = true;
      check.detail = 'Pattern found in source';
    } else {
      check.detail = `Pattern "${link.pattern}" not found in source`;
    }
  } catch {
    check.detail = `Invalid regex pattern: ${link.pattern}`;
  }
}
```
Delete the lines that read targetContent and test pattern against it.

**Verification:**
```bash
node -e "
const v = require('./atos-forge/bin/lib/verify.cjs');
// Should NOT verify if pattern only exists in target, not source
"
```

#### Task 2.3: Fix BEHAVIORAL must_check heuristic (Fix 7)

**Files:** `forge-verify/engine.js` — lines 835-873

**Change:** Replace the keyword heuristic (lines 850-869) with explicit files+pattern structure. String-form entries are skipped with a warning:
```js
for (const check of mustChecks) {
  const checkObj = typeof check === 'string'
    ? { description: check, files: null, pattern: null }
    : check;
  if (!checkObj.files || !checkObj.pattern) {
    results.push({
      label: `must_check: ${checkObj.description || check}`,
      command: '(plan verification_must_check)',
      passed: true, skipped: true, exit_code: 0, timed_out: false,
      stdout: 'Skipped - must_check entry needs explicit files and pattern fields',
      stderr: '',
    });
    continue;
  }
  const targets = Array.isArray(checkObj.files) ? checkObj.files : [checkObj.files];
  let regex;
  try { regex = new RegExp(checkObj.pattern); }
  catch { results.push({ label: `must_check: ${checkObj.description}`, command: '(plan verification_must_check)', passed: false, exit_code: 1, timed_out: false, stdout: `Invalid regex: ${checkObj.pattern}`, stderr: '' }); continue; }
  const found = targets.some(t => {
    try { return regex.test(fs.readFileSync(path.resolve(opts.cwd, t), 'utf8')); }
    catch { return false; }
  });
  results.push({
    label: `must_check: ${checkObj.description}`,
    command: `(plan verification_must_check: ${checkObj.pattern} in ${targets.join(',')})`,
    passed: found, exit_code: found ? 0 : 1, timed_out: false,
    stdout: found ? 'pattern matched' : `pattern not found in ${targets.join(', ')}`,
    stderr: '',
  });
}
```

**Verification:** Unit test with string-form and object-form must_check entries.

#### Task 2.4: Splitter test mode uses tmpdir (Fix 8)

**Files:** `forge-assess/splitter.js` — lines 1060-1296

**Change:** Replace `path.join(cwd, f)` synthetic file writes (lines 1078-1106) with `path.join(os.tmpdir(), 'forge-splitter-test', f)`. Add `const os = require('os');` at top if not present. Wrap in try/finally for cleanup. Remove the dangerous `fs.rmSync(srcDir, { recursive: true, force: true })` at line 1293 — replace with targeted cleanup of only the tmpdir.

**Verification:**
```bash
ls src/ > /tmp/before.txt
node forge-assess/splitter.js --test --root . 2>/dev/null || true
ls src/ > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
# Must be empty diff
```

#### Task 2.5: Debug template definition (Fix 15)

**Files:** `atos-forge/workflows/diagnose-issues.md` — around line 78

**Change:** Define the debug-subagent-prompt template literally inside the workflow, before the spawn step. Include all placeholders:
```markdown
<template name="debug-subagent-prompt">
You are debugging a verification failure.

## Goal
{goal}

## Truth that failed
{truth}

## Expected behavior
{expected}

## Actual behavior
{actual}

## Errors observed
{errors}

## Reproduction steps
{reproduction}

## Timeline of changes
{timeline}

## Session slug
{slug}

Instructions:
1. Read the failing files and understand the current state
2. Identify the root cause of the gap between expected and actual
3. Propose and implement a minimal fix
4. Verify the fix resolves the truth
5. Report findings in structured agent-output format
</template>
```

**Verification:** Template string is present in the file and all 8 placeholders are defined.

#### Task 2.6: Plan completion integrity check (Fix 16)

**Files:** `atos-forge/bin/lib/core.cjs` — lines 256-262, `atos-forge/bin/lib/phase.cjs` — lines 193-236

**Change:** Replace simple SUMMARY.md existence check with multi-criteria validation:
```js
function isPlanComplete(summaryPath) {
  if (!fs.existsSync(summaryPath)) return false;
  const content = fs.readFileSync(summaryPath, 'utf8');
  // Must contain Self-Check: PASSED
  if (!content.includes('## Self-Check: PASSED') && !content.includes('Self-Check: PASSED')) {
    return false;
  }
  // Must not have tests_failed > 0 in frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch && /tests_failed:\s*[1-9]/.test(fmMatch[1])) {
    return false;
  }
  return true;
}
```
Use this function in both `core.cjs` completedPlanIds and `phase.cjs` hasSummary checks.

**Verification:** Truncated or FAILED SUMMARY.md is not treated as complete.

#### Task 2.7: Executor Rule 1 scope (Fix 20)

**Files:** `agents/forge-executor.md` — lines 100-112

**Change:** Add explicit prohibition after Rule 1 trigger section:
```markdown
**Rule 1 Scope — Implementation only.**
Rule 1 modifies implementation code only. To modify a test file (*.test.*, *.spec.*, __tests__/*), raise a `checkpoint:decision` and wait for user approval. Tests written by the test-author wave are the contract — implementation must meet them, not the other way around. Never silently rewrite a failing test to make it pass.
```

**Verification:** Grep for "implementation code only" in forge-executor.md.

#### Task 2.8: Ledger write protection (Fix 23)

**Files:** `forge-session/ledger.js` — around line 148 (writeRaw) and line 184 (appendToSection)

**Change:** Use `proper-lockfile` or atomic write pattern. Simplest robust approach — batch writes via orchestrator:
```js
const lockfile = require('proper-lockfile');
function writeRaw(cwd, content) {
  ensureDir(ledgerDir(cwd));
  const p = ledgerPath(cwd);
  // Ensure file exists for lockfile
  if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf-8');
  const release = lockfile.lockSync(p, { retries: { retries: 5, minTimeout: 50 } });
  try {
    fs.writeFileSync(p, content, 'utf-8');
  } finally {
    release();
  }
}
```
Add `proper-lockfile` to `forge-session/package.json` (create if needed) and root `package.json`.
Also wrap `appendToSection` with the same lock pattern (read + modify + write must be atomic).

**Verification:** Concurrent writes from 4 parallel processes all persist correctly.

#### Task 2.9: Crash-recovery boot time (Fix 26)

**Files:** `forge-session/crash-recovery.js` — lines 43-52

**Change:** Add boot-time check before PID probe:
```js
const os = require('os');

function getBootTime() {
  return Math.floor(Date.now() / 1000) - os.uptime();
}

function readCrashLock(cwd) {
  const p = lockPath(cwd);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const startEpoch = Math.floor(new Date(data.startedAt).getTime() / 1000);
    if (startEpoch < getBootTime()) {
      data.processAlive = false; // Lock is from before last reboot
    } else {
      try { process.kill(data.pid, 0); data.processAlive = true; }
      catch { data.processAlive = false; }
    }
    return data;
  } catch { return null; }
}
```

**Verification:** Unit test mocking os.uptime() to return value less than lock age.

#### Task 2.10: Context-monitor fallback (Fix 27)

**Files:** `hooks/forge-context-monitor.js` — lines 51-53

**Change:** Replace `process.exit(0)` on stale metrics with transcript-size estimation fallback:
```js
if (metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS) {
  // Statusline stale — fall back to transcript-size estimation
  const inputLen = (input || '').length;
  if (inputLen > 0) {
    const estimatedTokens = Math.ceil(inputLen / 4);
    const estimatedCapacity = 200000; // Conservative context window estimate
    const usage = estimatedTokens / estimatedCapacity;
    if (usage > 0.75) {
      console.error(`[forge-context-monitor] CRITICAL: Estimated ${Math.round(usage * 100)}% context used (transcript fallback)`);
    } else if (usage > 0.65) {
      console.error(`[forge-context-monitor] WARNING: Estimated ${Math.round(usage * 100)}% context used (transcript fallback)`);
    }
  }
  // Do NOT exit — continue monitoring via transcript estimation
}
```

**Verification:** Long autonomous run with stale statusline still produces WARNING/CRITICAL.

#### Task 2.11: Slim planner prompt (Fix 29)

**Files:** `agents/forge-planner.md` (1277 lines), new `atos-forge/references/planner-cookbook.md`

**Change:** Extract to `planner-cookbook.md`:
1. Worked examples (lines ~318-376)
2. UI/UX specificity table (lines ~220-242)
3. Depth calibration tables (lines ~403-426)

Replace extracted sections with `@planner-cookbook.md` reference annotation. Target: ~5K tokens for base planner prompt (down from ~11K).

**Verification:** Word count of forge-planner.md drops by >= 50%. `/forge-plan-phase` on backend-only phase doesn't include UI specificity content.

#### Task 2.12: Slim verifier and plan-checker prompts (Fix 30)

**Files:** `agents/forge-verifier.md` (755 lines), `agents/forge-plan-checker.md` (748 lines), new `atos-forge/references/verifier-cookbook.md`

**Change:** Extract stub-detection patterns, worked examples, and lengthy checklists to `verifier-cookbook.md`. Target: ~3K tokens each for base prompts.

**Verification:** Combined token count drops by >= 6K.

#### Task 2.13: Researcher WebSearch budget (Fix 35)

**Files:** `agents/forge-project-researcher.md`, `agents/forge-phase-researcher.md`

**Change:** Add explicit budget caps to both agent prompts:
```markdown
## Tool Budget (mandatory)
- WebSearch: maximum 5 calls per research session
- WebFetch: maximum 3 calls per research session
- Prefer Context7 over WebSearch (cheaper, more accurate)
- WebSearch is most expensive and lowest-trust. Default to Context7. WebFetch when Context7 lacks the library. WebSearch only when both fail.
- After each WebSearch, immediately note which URL(s) to fetch and discard the rest from your working summary. Do not retain raw search snippets.
- Exceeding the budget requires explicit orchestrator grant.
```

**Verification:** Budget section present in both files. Grep for "maximum 5 calls" matches.

---

### PHASE 3: Pipeline Upgrades (All Parallel — depend on Phase 1 only)
**Rationale:** These 10 fixes all consume YAML-parsed frontmatter from Phase 1 but do not depend on each other. Each touches a different function/file.

#### Task 3.1: Propagate parent contract into sub-plans (Fix 4)

**Files:** `forge-assess/splitter.js` — `buildSubPlan` (lines 705-743), `formatSubPlanXML` (~line 749), `formatSubPlanJSON`
**Depends on:** Phase 1 (plan.frontmatter.must_haves must be populated)

**Change:** In `buildSubPlan`, after constructing the result object, attach parent_contract:
```js
const fm = plan.frontmatter || {};
const mh = fm.must_haves || {};
const fileSet = new Set(group.files);
const relevantKeyLinks = (mh.key_links || []).filter(kl =>
  fileSet.has(kl.from) || fileSet.has(kl.to)
);
const relevantArtifacts = (mh.artifacts || []).filter(a =>
  fileSet.has(a.path)
);
result.parent_contract = {
  objective: plan.objective || '',
  requirements: fm.requirements || [],
  truths: mh.truths || [],
  key_links: relevantKeyLinks,
  artifacts: relevantArtifacts,
  parent_must_haves_full: mh,
};
```
Update `formatSubPlanXML` to emit parent_contract back into sub-plan YAML frontmatter under `must_haves:` so factory auto-picks it up. Update `formatSubPlanJSON` to include parent_contract.

**Verification:**
```bash
node -e "const s=require('./forge-assess/splitter.js'); /* test splitPlan output has parent_contract */"
```

#### Task 3.2: Inject plan contract into agent system prompt (Fix 5)

**Files:** `forge-agents/factory.js` — `composeSystemPrompt` (lines 431-684)
**Depends on:** Phase 1 (must_haves in frontmatter)

**Change:** After the LOCKED DECISIONS section (line 626) and before `buildGroundingSection` (line 629), add Plan Contract section:
```js
const fm = analysis.plan?.frontmatter || {};
const mh = fm.must_haves || {};
const reqs = Array.isArray(fm.requirements) ? fm.requirements : [];
if (reqs.length || mh.truths?.length || mh.key_links?.length || mh.artifacts?.length) {
  parts.push('\n## Plan Contract (the goal - every truth must be true on completion)');
  if (analysis.plan?.objective) {
    parts.push(`\n**Objective:** ${analysis.plan.objective}`);
  }
  if (reqs.length) {
    parts.push(`\n**Requirements:** ${reqs.join(', ')}`);
  }
  if (mh.truths?.length) {
    parts.push('\n**Observable truths (each must be verifiable):**');
    mh.truths.forEach((t, i) => parts.push(`${i + 1}. ${t}`));
  }
  if (mh.artifacts?.length) {
    parts.push('\n**Required artifacts:**');
    for (const a of mh.artifacts) {
      const extras = [];
      if (a.min_lines) extras.push(`>=${a.min_lines} lines`);
      if (a.contains)  extras.push(`contains "${a.contains}"`);
      if (a.exports)   extras.push(`exports ${(Array.isArray(a.exports) ? a.exports : [a.exports]).join(', ')}`);
      parts.push(`- \`${a.path}\` - ${a.provides || ''}${extras.length ? ' (' + extras.join('; ') + ')' : ''}`);
    }
  }
  if (mh.key_links?.length) {
    parts.push('\n**Required wiring (checked by verifier - broken wiring = task failure):**');
    for (const l of mh.key_links) {
      parts.push(`- \`${l.from}\` -> \`${l.to}\` via ${l.via}${l.pattern ? ` (pattern: \`${l.pattern}\`)` : ''}`);
    }
  }
  parts.push('\nDo NOT mark any task complete unless the wiring above is in place.');
}
if (analysis.plan?.parent_contract) {
  const pc = analysis.plan.parent_contract;
  parts.push('\n## Parent Plan Contract (this sub-plan contributes to the parent goal)');
  if (pc.objective) parts.push(`**Parent objective:** ${pc.objective}`);
  if (pc.requirements?.length) parts.push(`**Requirements:** ${pc.requirements.join(', ')}`);
  if (pc.truths?.length) {
    parts.push('**Parent truths:**');
    pc.truths.forEach((t, i) => parts.push(`${i + 1}. ${t}`));
  }
}
```

**Verification:**
```bash
node forge-agents/factory.js build test-fixtures/plan.md --root . > /tmp/agent.json
node -e "const c=JSON.parse(require('fs').readFileSync('/tmp/agent.json')); console.log(c.agentConfig.system_prompt.includes('Plan Contract'));"
# Must print: true
```

#### Task 3.3: Add KEY_LINKS verification layer (Fix 6)

**Files:** `forge-verify/engine.js`, `forge-config/config.js`
**Depends on:** Phase 1 (key_links must be parseable from frontmatter)

**Change in engine.js:** Add `layerKeyLinks` function and wire as Layer 4.5 (after DEPENDENCY, before TESTS):
```js
function layerKeyLinks(opts) {
  const start = Date.now();
  if (!opts.planPath) {
    return { passed: true, links: [], skipped: true, reason: 'No plan provided', duration_ms: Date.now() - start };
  }
  let parseMustHavesBlock;
  try {
    ({ parseMustHavesBlock } = require(path.join(__dirname, '..', 'atos-forge', 'bin', 'lib', 'frontmatter.cjs')));
  } catch {
    return { passed: true, links: [], skipped: true, reason: 'frontmatter parser unavailable', duration_ms: Date.now() - start };
  }
  const planContent = fs.readFileSync(path.resolve(opts.cwd, opts.planPath), 'utf8');
  const links = parseMustHavesBlock(planContent, 'key_links');
  if (!links.length) {
    return { passed: true, links: [], skipped: true, reason: 'no key_links in plan', duration_ms: Date.now() - start };
  }
  const results = [];
  for (const link of links) {
    const sourcePath = path.join(opts.cwd, link.from || '');
    let verified = false, detail = '';
    try {
      const sourceContent = fs.readFileSync(sourcePath, 'utf8');
      if (link.pattern) {
        verified = new RegExp(link.pattern).test(sourceContent);
        detail = verified ? 'pattern found in source' : `pattern "${link.pattern}" not found in source`;
      } else {
        verified = sourceContent.includes(link.to || '');
        detail = verified ? 'target referenced in source' : 'target not referenced in source';
      }
    } catch (e) {
      detail = `source unreadable: ${e.message}`;
    }
    results.push({ from: link.from, to: link.to, via: link.via, pattern: link.pattern, verified, detail });
  }
  return {
    passed: results.every(r => r.verified),
    links: results,
    broken_count: results.filter(r => !r.verified).length,
    duration_ms: Date.now() - start,
  };
}
```
Add `'KEY_LINKS'` to `LAYER_NAMES` after `'DEPENDENCY'`. Wire into the dispatcher in `verify()`.

**Change in config.js:** Add `key_links: true` to `DEFAULTS.verification.layers`. Update `getVerification()` to map it.

**Verification:**
```bash
node forge-verify/engine.js --root . --plan test-plan.md --json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.layers.some(l=>l.name==='KEY_LINKS'));"
# Must print: true
```

#### Task 3.4: Wave-to-wave findings bridge (Fix 9)

**Files:** `forge-agents/factory.js` — `buildAgentConfig` (~line 1200)
**Depends on:** nothing (rendering side already works at line 659-666)

**Change:** In `buildAgentConfig`, accept `opts.previousFindings` and pass to analysis:
```js
// After analyzeTask call:
if (opts && opts.previousFindings && opts.previousFindings.length > 0) {
  analysis.previousFindings = opts.previousFindings;
}
```
Then in `extractSessionContext`, include previousFindings in the session context:
```js
if (opts && opts.previousFindings) {
  ctx.previous_findings = opts.previousFindings;
}
```
The system prompt rendering at lines 659-666 already handles `sessionContext.previous_findings`.

In `forge-containers/worktree-orchestrator.js` and `orchestrator.js` — after wave completion, collect findings and pass to next wave:
```js
// After wave patches applied:
const waveFindings = waveResults.flatMap(r => r.agentFindings || []);
// Pass to next wave's buildAgentConfig:
opts.previousFindings = waveFindings;
```

**Verification:** Second wave's system prompt includes "Previous Agent Findings" section.

#### Task 3.5: Extend agent cache key (Fix 10)

**Files:** `forge-agents/cache.js` — `computeInputHash` (lines 31-89)
**Depends on:** nothing

**Change:** Extend the hash function signature to accept opts, add planning file mtimes:
```js
function computeInputHash(planPath, cwd, opts) {
  // ... existing hash inputs 1-6 ...

  // 7. Planning docs modification times
  const planningFiles = ['.planning/REQUIREMENTS.md', '.planning/ROADMAP.md', '.planning/PROJECT.md', '.planning/STATE.md'];
  for (const p of planningFiles) {
    try {
      const stat = fs.statSync(path.join(cwd, p));
      hash.update(`${p}_mtime:${stat.mtimeMs}`);
    } catch {
      hash.update(`${p}_mtime:none`);
    }
  }

  // 8. Factory version (bump when factory logic changes materially)
  const FACTORY_VERSION = 'v2.0';
  hash.update(`factory:${FACTORY_VERSION}`);

  // 9. Previous-wave findings
  if (opts?.previousFindings) {
    hash.update(`prev_findings:${JSON.stringify(opts.previousFindings)}`);
  }

  return hash.digest('hex');
}
```
Update all callers of `computeInputHash` to pass opts.

**Verification:** Changing REQUIREMENTS.md produces a different hash.

#### Task 3.6: Agent output JSON-Schema validation (Fix 14)

**Files:** `forge-agents/agent-output-schema.js`
**Depends on:** nothing

**Change:** Add formal schema validation to `validateOutput`:
```js
const REQUIRED_FIELDS = ['findings', 'decisions_made', 'files_created', 'files_modified', 'confidence'];
function validateOutput(output) {
  const issues = [];
  if (!output || typeof output !== 'object') {
    issues.push('Agent output is not a valid object');
    return { valid: false, issues, normalized: null };
  }
  if (!Array.isArray(output.findings)) issues.push('findings must be an array');
  if (!Array.isArray(output.decisions_made)) issues.push('decisions_made must be an array');
  if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
    issues.push('confidence must be a number between 0 and 1');
  }
  // Validate finding structure
  if (Array.isArray(output.findings)) {
    for (const f of output.findings) {
      if (!f.type || !f.description) issues.push(`Finding missing type or description: ${JSON.stringify(f)}`);
    }
  }
  return { valid: issues.length === 0, issues, normalized: output };
}
```
In orchestrators, log validation issues to ledger as warnings instead of silently ignoring.

**Verification:** Malformed agent output triggers ledger warning, does not crash.

#### Task 3.7: Common vocabulary reference (Fix 28)

**Files:** new `atos-forge/references/common-vocabulary.md`
**Depends on:** nothing

**Change:** Create the vocabulary file defining: `must_haves`, `key_links`, `truths`, `artifacts`, `requirements`, `CONTEXT.md`, `STATE.md`, `SUMMARY.md`, `Phase Boundary`, `goal-backward`, `frontmatter`, `Locked Decisions`, `wave`, `archetype`, `parent_contract`. Each term gets a 1-2 sentence definition. This is description-only, not procedural.

Strip duplicate definitions from agent prompts that define these terms inline. Replace with `@common-vocabulary.md` reference.

**Verification:** Reference file exists. Agent prompts reference it via @-annotation.

#### Task 3.8: Cap ledger inclusion (Fix 32)

**Files:** `forge-agents/factory.js` — `extractSessionContext` (~line 1027) and `composeSystemPrompt` (~line 563)
**Depends on:** nothing

**Change:** In `extractSessionContext`, cap at last 30 entries per category:
```js
const MAX_ENTRIES_PER_CATEGORY = 30;
if (sections.decisions) ctx.decisions = extractBulletItems(sections.decisions).slice(-MAX_ENTRIES_PER_CATEGORY);
if (sections.warnings) ctx.warnings = extractBulletItems(sections.warnings).slice(-MAX_ENTRIES_PER_CATEGORY);
if (sections.preferences) ctx.user_preferences = extractBulletItems(sections.preferences).slice(-MAX_ENTRIES_PER_CATEGORY);
if (sections.rejected) ctx.rejected_approaches = extractBulletItems(sections.rejected).slice(-MAX_ENTRIES_PER_CATEGORY);
```

**Verification:** 500-entry ledger yields <= 120 entries in system prompt (30 x 4 categories).

#### Task 3.9: Cache composed system prompt scaffold (Fix 33)

**Files:** `forge-agents/factory.js`
**Depends on:** nothing

**Change:** Memoize the system prompt scaffold (everything except task-specific plan content):
```js
let _promptScaffoldCache = { key: null, scaffold: null };

function composeSystemPrompt(analysis, archetypeResult, sessionContext) {
  // Compute scaffold cache key (excludes plan-specific content)
  const scaffoldKey = crypto.createHash('sha256')
    .update(archetypeResult.archetype)
    .update(JSON.stringify(sessionContext || {}))
    .update(JSON.stringify(analysis.capabilities || {}))
    .digest('hex');

  if (_promptScaffoldCache.key === scaffoldKey && _promptScaffoldCache.scaffold) {
    // Reuse cached scaffold, only rebuild plan-specific sections
    return _promptScaffoldCache.scaffold + buildPlanSpecificSections(analysis);
  }

  // ... existing full build ...
  // Cache the scaffold portion
  _promptScaffoldCache = { key: scaffoldKey, scaffold: scaffoldParts.join('\n') };
  return parts.join('\n');
}
```

**Verification:** Second call with same graph/session but different plan reuses scaffold.

#### Task 3.10: Skip cache for revision and fix agents (Fix 12)

**Files:** `atos-forge/workflows/execute-phase.md` (~line 513), `atos-forge/workflows/plan-phase.md` (revision spawn)
**Depends on:** nothing

**Change:** In execute-phase.md step 5d, add `--skip-cache` to fix-agent factory build command. In plan-phase.md revision loop, route revision planner through factory with `--skip-cache`.

**Verification:** Grep for `--skip-cache` in both workflow files confirms presence.

---

### PHASE 4: Integration & Complex Fixes (All Parallel — depend on Phases 2-3)
**Rationale:** These 11 fixes build on the core pipeline established in Phases 1-3. Each touches different files and can run in parallel.

#### Task 4.1: Patch applier DAG ordering and conflict guard (Fix 11)

**Files:** `forge-containers/patch-collector.js`, `forge-containers/worktree-orchestrator.js`
**Depends on:** Phase 3 (DAG info from parallel-planner)

**Change:**
1. Pre-apply conflict guard: parse each patch's `diff --git a/... b/...` headers, build per-patch file sets, assert no intersection. Fail fast with clear error listing conflicting files.
2. DAG-ordered apply: use parallel-planner's dependency info to sort patches topologically.
3. Wave-level transaction: snapshot `git rev-parse HEAD` before wave, `git reset --hard` to snapshot on any failure after fix-loops exhausted.

**Verification:** Test with two patches touching same file — applier detects conflict before apply.

#### Task 4.2: Per-wave fast verifier (Fix 21)

**Files:** `forge-verify/loop.js`, `atos-forge/workflows/execute-phase.md` step 5d
**Depends on:** Phase 3 Task 3.3 (KEY_LINKS layer must exist)

**Change:** Wire `verifyAfterWave` in execute-phase step 5c/5d. Add layer restriction:
```js
async function verifyAfterWave(opts) {
  return verifyLoop({
    ...opts,
    maxLoops: opts.maxLoops ?? 2,
    incremental: true,
    maxLayer: 5,  // STRUCTURAL + TYPE + INTERFACE + DEPENDENCY + KEY_LINKS only
    mode: 'wave',
  });
}
```
In execute-phase.md, replace the inline tsc+eslint check with a call to `verifyAfterWave`.

**Verification:** Broken key_link after wave 1 prevents wave 2 from starting.

#### Task 4.3: Per-wave code reviewer (Fix 13)

**Files:** new `agents/forge-code-reviewer.md`, `atos-forge/workflows/execute-phase.md` step 5d
**Depends on:** Phase 3 Task 3.3 (KEY_LINKS for review criteria)

**Change:** Create `forge-code-reviewer.md` agent that:
- Reads changed files + plan's must_haves + relevant key_links
- Returns issues if any artifact is a stub or any link unwired
- Uses balanced model profile (sonnet)

Wire into execute-phase.md after wave patches apply — cap at 2 review iterations per wave.

**Verification:** Stub handler in test project is flagged by reviewer before wave commits.

#### Task 4.4: Proper subagent_type for all workflow spawns (Fix 34)

**Files:** `atos-forge/workflows/plan-phase.md` (4 sites), `atos-forge/workflows/new-project.md` (4 sites), `atos-forge/workflows/quick.md` (1 site), `atos-forge/workflows/diagnose-issues.md` (1 site)
**Depends on:** Phase 2 Task 2.5 (debug template for diagnose-issues.md)

**Change:** Replace all `subagent_type="general-purpose"` + `"First, read ~/.claude/agents/forge-X.md"` with proper `subagent_type="forge-X"`:
- plan-phase.md: researcher -> `forge-phase-researcher`, planner -> `forge-planner` (3 sites)
- new-project.md: 4 researchers -> `forge-project-researcher`
- quick.md: planner -> `forge-planner`
- diagnose-issues.md: debugger -> `forge-debugger`

**Verification:** Grep for `subagent_type="general-purpose"` returns 0 matches across all workflow files.

#### Task 4.5: Auto mode factory integration (Fix 17)

**Files:** `forge-auto/dispatcher.js`, `forge-auto/auto.js`
**Depends on:** Phase 3 Tasks 3.2 + 3.3 (factory pipeline must work with contracts and KEY_LINKS)

**Change:**
1. "execute" unit: replace `buildPrompt` with `require('../forge-agents/factory').buildAgentConfig(planPath, cwd)`. Spawn via worktree orchestrator path.
2. "plan" unit: use planner agent definition via proper subagent_type.
3. "verify" unit: invoke verification engine with all layers.
4. Remove `truncate-to-4000-chars` approach — factory handles context budget.
5. Crash recovery restarts at same wave/agent, not entire phase.

**Verification:** `/forge-auto` against test project produces verification results identical to manual `/forge-plan-phase` + `/forge-execute-phase` + `/forge-verify-work`.

#### Task 4.6: Research integrity gate (Fix 18)

**Files:** new `agents/forge-research-checker.md`, `atos-forge/workflows/plan-phase.md` step 5
**Depends on:** nothing specific

**Change:**
1. Create `forge-research-checker.md`:
   - Validates RESEARCH.md structure (required sections present)
   - Checks confidence labels
   - HIGH-confidence claims must cite primary source URLs
   - Cross-references for contradictions
   - Returns `## RESEARCH PASSED` or `## RESEARCH ISSUES FOUND`
2. Add 2-iteration revision loop in plan-phase.md step 5
3. Add freshness check: read `valid_until` from RESEARCH.md YAML frontmatter; if expired, require `--use-stale` or re-research

**Verification:** Contradictory RESEARCH.md is flagged; expired date triggers re-research prompt.

#### Task 4.7: Test-author agent before implementation (Fix 19)

**Files:** new `agents/forge-test-author.md`, `atos-forge/workflows/execute-phase.md`
**Depends on:** Phase 1 (must_haves.truths must be parsed)

**Change:**
1. Create `forge-test-author.md`:
   - Reads must_haves.truths, key_links, requirements
   - Writes one test per truth (tests fail against empty repo — intentional)
2. Insert Wave 0 in execute-phase.md before implementation waves:
   - Wave 0: test-author writes failing tests from truths
   - Wave 1..N: executor writes implementation
   - Final: verifier confirms truths satisfied and tests pass

**Verification:** Plan with truths produces failing tests first; implementation makes them pass.

#### Task 4.8: Truth-driven add-tests workflow (Fix 22)

**Files:** `atos-forge/workflows/add-tests.md`
**Depends on:** Phase 1 (must_haves.truths must be parsed)

**Change:** Replace TDD/E2E/Skip classifier table (lines 57-68) with truth-to-test mapping:
- Read must_haves.truths from PLAN.md
- For each truth without a corresponding test, generate one
- Fall back to classifier only if must_haves absent (legacy plans)

**Verification:** `/forge-add-tests` on phase with 7 truths produces exactly 7 tests.

#### Task 4.9: Codebase docs loading (Fix 24)

**Files:** `atos-forge/bin/lib/init.cjs` — `cmdInitPlanPhase` and `cmdInitExecutePhase`
**Depends on:** nothing

**Change:** Add `codebaseDocsForPhaseType(phaseType)` helper:
```js
function codebaseDocsForPhaseType(cwd) {
  const docsDir = path.join(cwd, '.planning', 'codebase');
  const docFiles = ['ARCHITECTURE.md', 'CONVENTIONS.md', 'STRUCTURE.md', 'TESTING.md', 'CONCERNS.md', 'INTEGRATIONS.md'];
  const docs = {};
  for (const f of docFiles) {
    const p = path.join(docsDir, f);
    if (fs.existsSync(p)) {
      docs[f.replace('.md', '').toLowerCase()] = safeReadFile(p);
    }
  }
  return docs;
}
```
Call from `cmdInitPlanPhase` when `includes.has('codebase')` and return as `codebase_docs` in result. Add `codebase` to the includes list in plan-phase.md step 7.

**Verification:** `/forge-plan-phase` on project with codebase docs loads them.

#### Task 4.10: Summary-then-load for init includes (Fix 31)

**Files:** `atos-forge/bin/lib/init.cjs` — `cmdInitPlanPhase`, `cmdInitExecutePhase`
**Depends on:** nothing

**Change:** Replace full `safeReadFile` inlining with summary approach:
```js
function summarizeFile(filePath, maxLines = 50) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    return {
      path: filePath,
      total_lines: lines.length,
      total_chars: content.length,
      summary: lines.slice(0, maxLines).join('\n'),
      full_content_available: true,
    };
  } catch { return null; }
}
```
Use summaries for large files (>200 lines). Sub-agents read full content via Read tool when needed. Add `context_insufficient: true` signal capability.

**Verification:** Large REQUIREMENTS.md (>200 lines) returns summary, not full content.

#### Task 4.11: Research provenance and brownfield refresh (Fix 25)

**Files:** `agents/forge-requirement-enhancer.md`, new `atos-forge/workflows/research-refresh.md`
**Depends on:** nothing

**Change:**
1. Add `source_dimension` and `source_confidence` to requirement-enhancer output YAML
2. Create `/forge-research-refresh` workflow:
   - Diff existing research `valid_until` against today
   - Diff `package.json` against research-time snapshot
   - Re-spawn only stale dimensions
   - Archive prior research to `.planning/research/archive/{date}/`

**Verification:** `/forge-research-refresh` on stale project re-spawns only stale dimensions.

---

### PHASE 5: Testing & Final Validation (Sequential — depends on all prior)
**Rationale:** Creates regression tests that verify all fixes work together.

#### Task 5.1: Multi-runtime conversion conformance tests (Fix 36)

**Files:** new `tests/install-conversions.test.cjs`
**Depends on:** All prior phases

**Change:** For each agent prompt x 3 runtimes (Codex, Opencode, Gemini) = 36+ cases. Assert:
- Output non-empty
- Frontmatter parseable as YAML
- `${VAR}` patterns preserved
- No tag content lost
- Round-trip recognizable

**Verification:** All test cases pass via `node --test tests/install-conversions.test.cjs`.

#### Task 5.2: Requirements pipeline regression test

**Files:** new `tests/requirements-pipeline.test.cjs`
**Depends on:** All prior phases

**Change:** Automate the baseline harness:
- B1: parsePlan returns tasks, full frontmatter keys, non-empty objective
- B2: factory output includes must_haves in frontmatter
- B3: verify artifacts returns meaningful pass/fail
- B4: engine returns FAIL for broken implementation
- S4: file ownership conflict detected by patch applier
- S5: stub implementation fails verification

**Verification:** `node --test tests/requirements-pipeline.test.cjs` passes.

---

## Error Handling

### Per-fix verification
Every fix has a defined acceptance command that must pass before the fix is committed. If an acceptance command fails, the fix session must diagnose and retry — NOT adjust the check.

### Cross-fix regression
After each phase completes, all prior phase acceptance commands are re-run. Any regression blocks the next phase.

### Rollback strategy
Each fix is committed separately. If a fix introduces regressions in previously-passing fixes, revert that fix's commit and re-implement.

---

## Cross-Cutting Concerns

### npm dependency management
- Fix 1 adds `yaml` package to `forge-assess/package.json` and root `package.json`
- Fix 23 adds `proper-lockfile` to `forge-session/package.json` and root `package.json`
- After all Phase 1 changes: run `npm install` in both module directories
- Verify air-gapped compatibility: both packages are pure JS, no native deps

### Agent prompt consistency
- Fixes 28-30 reduce agent prompt sizes — verify all agent functionality still works after extraction
- Fix 34 changes subagent_type across 10 workflow call sites — verify each workflow still spawns correctly

### Test file naming
- All new test files use `.test.cjs` extension (existing convention)
- Tests use Node.js built-in test runner (`node --test`)

### Git commit convention
- One commit per fix: `fix(module): description` or `feat(module): description`
- Phase completion tagged: `phase-N-complete`
