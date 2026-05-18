# Forge Improvement Architecture: Implementation Guide

> This document provides the complete technical architecture for implementing 15 improvements to Forge, derived from simulation of 6 end-to-end project builds (avg 5.7M tokens, 131 agents, $186-259/project) and cross-referenced with 2025-2026 industry research from Anthropic, Karpathy, Osmani, Stack Overflow, and Reddit developer communities.

---

## Table of Contents

1. [IMP-01: Smart Model Tiering for Agents](#imp-01-smart-model-tiering-for-agents)
2. [IMP-02: Token Budget Dashboard & Per-Phase Reporting](#imp-02-token-budget-dashboard--per-phase-reporting)
3. [IMP-03: Fix Assessor Context Limit](#imp-03-fix-assessor-context-limit)
4. [IMP-04: Spec Quality Gate Before Execution](#imp-04-spec-quality-gate-before-execution)
5. [IMP-05: Incremental Code Graph Updates](#imp-05-incremental-code-graph-updates)
6. [IMP-06: Sub-Agent Summary Compression Protocol](#imp-06-sub-agent-summary-compression-protocol)
7. [IMP-07: Structured Audit Trail](#imp-07-structured-audit-trail)
8. [IMP-08: Diff-Aware Verification](#imp-08-diff-aware-verification)
9. [IMP-09: Package Hallucination Guard](#imp-09-package-hallucination-guard)
10. [IMP-10: Explorer-Critic Pattern for High-Risk Phases](#imp-10-explorer-critic-pattern-for-high-risk-phases)
11. [IMP-11: Progressive Context Loading](#imp-11-progressive-context-loading)
12. [IMP-12: Ledger Write Batching](#imp-12-ledger-write-batching)
13. [IMP-13: Graph-Informed Token Estimation](#imp-13-graph-informed-token-estimation)
14. [IMP-14: GitHub Actions Integration](#imp-14-github-actions-integration)
15. [IMP-15: Speculative Verify-Fix Execution](#imp-15-speculative-verify-fix-execution)
16. [Testing Strategy](#testing-strategy)
17. [Implementation Order & Dependencies](#implementation-order--dependencies)

---

## IMP-01: Smart Model Tiering for Agents

### Problem

All 15 agent types in `.codex/agents/*.toml` default to `model = "o3"` (Opus-tier). Agents like `forge-research-checker` (43 lines of instructions), `forge-test-author` (43 lines), and `forge-code-reviewer` (58 lines) perform simple validation tasks that don't need Opus-level reasoning. Across 131 average agent spawns per project, this wastes 30-45% of total cost.

### Architecture

**Files to modify:**
- `.codex/agents/forge-research-checker.toml` — change `model = "o3"` to `model = "haiku"`
- `.codex/agents/forge-test-author.toml` — change `model = "o3"` to `model = "haiku"`
- `.codex/agents/forge-code-reviewer.toml` — change `model = "o3"` to `model = "sonnet"`
- `.codex/agents/forge-research-synthesizer.toml` — change `model = "o3"` to `model = "sonnet"`
- `.codex/agents/forge-plan-checker.toml` — change `model = "o3"` to `model = "sonnet"`
- `.codex/agents/forge-roadmapper.toml` — change `model = "o3"` to `model = "sonnet"`
- `.codex/agents/forge-phase-researcher.toml` — change `model = "o3"` to `model = "sonnet"`
- `.codex/agents/forge-project-researcher.toml` — change `model = "o3"` to `model = "sonnet"`
- `.codex/agents/forge-codebase-mapper.toml` — change `model = "o3"` to `model = "sonnet"`
- `.codex/agents/forge-requirement-enhancer.toml` — change `model = "o3"` to `model = "sonnet"`
- `.codex/agents/forge-integration-checker.toml` — change `model = "o3"` to `model = "sonnet"`

**Keep at Opus (unchanged):**
- `forge-planner.toml` — 1,265-line instructions, complex goal-backward reasoning
- `forge-executor.toml` — complex code generation, deviation handling
- `forge-verifier.toml` — multi-dimensional goal-backward verification
- `forge-debugger.toml` — scientific method debugging, 1,190-line instructions

**Config override mechanism:** The existing `forge-config/config.js` already has `agents.active_profile` with values `quality`/`balanced`/`budget`. This maps to opus/sonnet/haiku. The model profile resolution logic in `forge-cli/references/model-profile-resolution.md` states that Opus-tier agents resolve to `"inherit"`. 

**Implementation detail:** Add a `tier` field to each TOML file that the factory.js can read:

```toml
# forge-research-checker.toml
name = "forge-research-checker"
model = "haiku"
tier = "validation"  # validation | synthesis | reasoning | generation
```

The `forge-agents/factory.js` (line ~73-91, `loadAgentDirectives()`) already loads agent config. Add tier-aware model override logic that respects the user's `active_profile`:
- If `active_profile = "quality"` → all agents use Opus regardless of TOML `model`
- If `active_profile = "balanced"` → use TOML `model` as-is (the new default)
- If `active_profile = "budget"` → downgrade all to Haiku except `tier = "generation"` (which gets Sonnet)

### Testing

1. Unit test: For each profile setting (`quality`/`balanced`/`budget`), verify model resolution produces the expected model per agent type
2. Integration test: Run `/forge-plan-phase` on a test project and verify that `forge-research-checker` logs show `model: haiku`, while `forge-planner` shows `model: opus`
3. Regression test: Run full pipeline on a small project (3-phase) with `balanced` profile, compare output quality against baseline `quality` run — verify no degradation in plan/execution quality

---

## IMP-02: Token Budget Dashboard & Per-Phase Reporting

### Problem

`forge-session/metrics.js` (89 lines) already tracks per-unit token data (`snapshotUnitMetrics()` at line 30) and has budget ceiling support (`checkBudget()` at line 72), but this data is never surfaced to users. The metrics file exists at `.forge/session/metrics.json` but no CLI command or UI displays it.

### Architecture

**Files to modify:**
- `forge-cli/bin/forge-tools.cjs` — add `metrics` subcommand with `summary`, `phase`, `estimate` actions
- `forge-session/metrics.js` — add `estimatePhaseTokens()` function based on plan count and historical averages
- `forge-cli/workflows/execute-phase.md` — add token estimate display at the interactive gate (step 8)
- `forge-cli/lib/metrics.cjs` — new library file for CLI rendering

**New CLI commands:**
```bash
node forge-cli/bin/forge-tools.cjs metrics summary          # Total project cost table
node forge-cli/bin/forge-tools.cjs metrics phase <N>         # Per-phase breakdown
node forge-cli/bin/forge-tools.cjs metrics estimate <N>      # Pre-execution estimate
node forge-cli/bin/forge-tools.cjs metrics set-ceiling <USD> # Set budget ceiling
```

**Implementation for `metrics summary`:**
```javascript
// forge-cli/lib/metrics.cjs
function renderSummary(cwd) {
  const { getProjectTotals } = require('../../forge-session/metrics');
  const totals = getProjectTotals(cwd);
  
  const table = [
    ['Phase', 'Agents', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Cost (USD)'],
  ];
  for (const [phase, data] of Object.entries(totals.by_phase)) {
    table.push([phase, data.count, /* ... token breakdown ... */]);
  }
  // Render as markdown table
  return formatTable(table);
}
```

**Implementation for `metrics estimate`:**
The estimation function uses historical data from `metrics.json` if available, falling back to simulation-derived averages:
```javascript
function estimatePhaseTokens(cwd, phaseNum) {
  const metrics = loadMetrics(cwd);
  const historicalAvg = metrics.units.length > 0
    ? metrics.units.reduce((sum, u) => sum + (u.tokens?.total || 0), 0) / metrics.units.length
    : 45000; // Simulation-derived default: ~45K tokens per agent
  
  // Count plans in phase
  const planCount = countPlansInPhase(cwd, phaseNum);
  // Estimate agents: 1 researcher + 1 checker + 1 planner + 1 plan-checker + planCount executors + 1 reviewer + 1 verifier
  const estimatedAgents = 4 + planCount + 2;
  return {
    estimated_tokens: estimatedAgents * historicalAvg,
    estimated_cost_usd: estimateUSD(estimatedAgents * historicalAvg),
    agent_breakdown: { research: 2, planning: 2, execution: planCount, verification: 2 },
  };
}
```

**Workflow integration (execute-phase.md, step 8 — interactive gate):**
Before the user approves execution, display:
```
## Execution Estimate
- Plans: 5 | Waves: 3 | Estimated agents: 11
- Estimated tokens: ~520,000 | Estimated cost: ~$17.50
- Budget remaining: $182.50 / $200.00
Proceed? [Y/n]
```

**Budget warning integration:**
In `execute-phase.md`, before spawning each wave, call `checkBudget()`. If `remaining_usd < estimated cost of remaining waves`, warn the user with option to continue or stop.

### Testing

1. Unit test: `estimatePhaseTokens()` returns reasonable estimates for 1-plan, 5-plan, and 10-plan phases
2. Unit test: `renderSummary()` produces valid markdown table with correct column alignment
3. Integration test: Run a small execution, verify `metrics.json` was written with correct `tokens` and `cost_usd` fields
4. Integration test: Verify `forge-tools.cjs metrics summary` CLI command outputs without error and shows non-zero data
5. Edge case test: Budget ceiling hit mid-execution — verify warning message and graceful stop option

---

## IMP-03: Fix Assessor Context Limit

### Problem

`forge-assess/assessor.js` line 13 hardcodes `CONTEXT_LIMIT = 128000`. The actual Claude 4.x context window is 200K tokens. `forge-agents/factory.js` already uses `DEFAULT_CONTEXT_WINDOW = 200000`. This mismatch causes unnecessary plan splitting.

### Architecture

**File to modify:** `forge-assess/assessor.js`

**Current code (line 13):**
```javascript
const CONTEXT_LIMIT = 128000;       // Claude context window
```

**New code:**
```javascript
// Read from unified config, matching factory.js DEFAULT_CONTEXT_WINDOW
function getContextLimit(cwd) {
  try {
    const config = require('../forge-config/config');
    const exec = config.getExecution(cwd);
    return exec.context_budget || 200000;
  } catch {
    return 200000;
  }
}
```

Then replace all references to the constant `CONTEXT_LIMIT` with a call to `getContextLimit(cwd)`. The `USABLE_CONTEXT` computation (line 15) becomes dynamic:
```javascript
function getUsableContext(cwd) {
  const cfg = loadForgeConfig(cwd);
  const limit = cfg.context_budget || 200000;
  const margin = cfg.safety_margin || SAFETY_MARGIN;
  return Math.floor(limit * (1 - margin));
}
```

Note: `loadForgeConfig()` already exists at line 44 and already reads `execution.context_budget` from config. The fix is simply to use `cfg.context_budget` (which it already loads) instead of the hardcoded `128000`. The `CONFIG_DEFAULTS` at line 34 even has `context_budget: CONTEXT_LIMIT` — so the fix is just changing line 13 from `128000` to `200000`.

**Simplest correct fix:** Change line 13 to `const CONTEXT_LIMIT = 200000;`

### Testing

1. Unit test: With default config, `getUsableContext()` returns `160000` (200K * 0.80)
2. Unit test: With custom `execution.context_budget = 150000` in config, returns `120000`
3. Integration test: Create a plan that would fit in 200K but not 128K context — verify it is NOT split (before the fix, it would be)
4. Regression test: Verify plans that genuinely need splitting still get split correctly

---

## IMP-04: Spec Quality Gate Before Execution

### Problem

`/forge-execute-phase` starts without validating that the phase's mapped requirements are specific and testable. Vague requirements produce "almost right" code, triggering expensive gap-closure cycles.

### Architecture

**Files to modify:**
- `forge-cli/lib/requirements.cjs` — add `validatePhaseRequirements(cwd, phaseNum)` function
- `forge-cli/bin/forge-tools.cjs` — add `requirements validate-phase <N>` subcommand
- `forge-cli/workflows/execute-phase.md` — add quality gate after step 1 (initialization)

**Quality criteria (from `forge-cli/templates/requirements.md`):**
1. **Specific & Testable**: Contains acceptance criteria or measurable outcome
2. **Atomic**: Addresses exactly one concern
3. **Unambiguous**: Only one interpretation possible

**Implementation:**
```javascript
// forge-cli/lib/requirements.cjs
function validatePhaseRequirements(cwd, phaseNum) {
  const reqs = loadRequirements(cwd);
  const roadmap = loadRoadmap(cwd);
  const phaseReqs = getRequirementsForPhase(roadmap, phaseNum);
  
  const issues = [];
  for (const reqId of phaseReqs) {
    const req = reqs.find(r => r.id === reqId);
    if (!req) { issues.push({ id: reqId, issue: 'NOT_FOUND' }); continue; }
    
    // Check 1: Has acceptance criteria (look for "when", "should", "must", "returns", measurable terms)
    const hasAcceptance = /\b(when|should|must|returns?|displays?|sends?|creates?|validates?|rejects?)\b/i.test(req.text);
    if (!hasAcceptance) {
      issues.push({ id: reqId, issue: 'MISSING_ACCEPTANCE_CRITERIA', text: req.text, 
        suggestion: 'Add specific acceptance criteria: "When X happens, the system should Y"' });
    }
    
    // Check 2: Not too broad (more than 2 "and" conjunctions suggests non-atomic)
    const andCount = (req.text.match(/\band\b/gi) || []).length;
    if (andCount > 2) {
      issues.push({ id: reqId, issue: 'NON_ATOMIC', text: req.text,
        suggestion: 'Split into smaller requirements — this one addresses multiple concerns' });
    }
    
    // Check 3: Not vague (flag common vague terms)
    const vagueTerms = /\b(various|etc|appropriate|suitable|good|nice|proper|adequate|reasonable)\b/i;
    if (vagueTerms.test(req.text)) {
      issues.push({ id: reqId, issue: 'AMBIGUOUS', text: req.text,
        suggestion: 'Replace vague terms with specific, measurable criteria' });
    }
  }
  
  return { passed: issues.length === 0, issues, phase: phaseNum, total_requirements: phaseReqs.length };
}
```

**Workflow integration (execute-phase.md):**
After step 1 (initialization), before step 2 (branching):
```markdown
## Step 1b: Spec Quality Gate
Run: `node forge-cli/bin/forge-tools.cjs requirements validate-phase {phase_num}`
- If all pass: continue
- If issues found: display issues with suggestions, offer three options:
  1. Fix requirements now (edit REQUIREMENTS.md)
  2. Run /forge-enhance-requirements to improve
  3. Override with --force flag (log warning to ledger)
```

### Testing

1. Unit test: Requirement "Users can log in with email/password, receiving JWT valid for 24 hours" → PASSES all 3 checks
2. Unit test: Requirement "The system should handle various user interactions appropriately" → FAILS with AMBIGUOUS + MISSING_ACCEPTANCE_CRITERIA
3. Unit test: Requirement "Users can register and login and manage profiles and update settings and export data" → FAILS with NON_ATOMIC
4. Integration test: Execute-phase on a phase with one vague requirement → blocks with clear message
5. Integration test: Execute-phase with `--force` flag → proceeds despite quality issues (logs warning)

---

## IMP-05: Incremental Code Graph Updates

### Problem

`forge-graph/builder.js` deletes `graph.db` entirely on each build (the `buildGraph()` function calls `db.exec('DROP TABLE IF EXISTS ...')` for all 14 tables). A 5,000-file repo pays the full scan cost (30-120s) even when 3 files changed.

### Architecture

**Files to modify:**
- `forge-graph/builder.js` — add `buildIncremental()` function alongside existing `buildGraph()`
- `forge-graph/query.js` — add `lastBuildCommit()` query
- `forge-cli/bin/forge-tools.cjs` — add `--incremental` flag to `graph init`

**Database schema addition:**
Add a `build_metadata` table to `graph.db`:
```sql
CREATE TABLE IF NOT EXISTS build_metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- Stored keys: last_build_commit, last_build_timestamp, schema_version
```

**Incremental build algorithm:**
```javascript
async function buildIncremental(repoRoot, options = {}) {
  const db = openDB(repoRoot);
  
  // 1. Check if incremental is possible
  const lastCommit = db.prepare('SELECT value FROM build_metadata WHERE key = ?').get('last_build_commit');
  const schemaVersion = db.prepare('SELECT value FROM build_metadata WHERE key = ?').get('schema_version');
  
  if (!lastCommit || schemaVersion?.value !== CURRENT_SCHEMA_VERSION) {
    console.log('  [info] Full rebuild required (no previous build or schema changed)');
    return buildGraph(repoRoot, options);
  }
  
  // 2. Get changed files since last build
  const diffOutput = execSync(
    `git diff --name-only --diff-filter=ACDMR ${lastCommit.value} HEAD`,
    { cwd: repoRoot, encoding: 'utf8', timeout: 10000 }
  ).trim();
  
  if (!diffOutput) {
    console.log('  [info] No changes since last build');
    return { incremental: true, changes: 0 };
  }
  
  const changedFiles = diffOutput.split('\n').filter(f => {
    const ext = path.extname(f);
    return LANGUAGE_EXTENSIONS[ext] && !IGNORE_DIRS.some(d => f.startsWith(d + '/'));
  });
  
  // 3. Delete old data for changed files
  const deleteStmt = db.prepare('DELETE FROM files WHERE file_path = ?');
  const deleteSymbols = db.prepare('DELETE FROM symbols WHERE file_id IN (SELECT id FROM files WHERE file_path = ?)');
  const deleteDeps = db.prepare('DELETE FROM dependencies WHERE source_file = ? OR target_file = ?');
  
  db.transaction(() => {
    for (const file of changedFiles) {
      deleteSymbols.run(file);
      deleteDeps.run(file, file);
      deleteStmt.run(file);
    }
  })();
  
  // 4. Re-parse only changed files (reuse existing parse pipeline)
  for (const file of changedFiles) {
    const fullPath = path.join(repoRoot, file);
    if (fs.existsSync(fullPath)) {
      parseAndInsertFile(db, repoRoot, file, fullPath);
    }
  }
  
  // 5. Update git history for changed files only
  updateGitHistory(db, repoRoot, changedFiles);
  
  // 6. Recompute module stats (lightweight — just aggregation queries)
  recomputeModuleStats(db);
  
  // 7. Update build metadata
  const currentCommit = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  db.prepare('INSERT OR REPLACE INTO build_metadata (key, value) VALUES (?, ?)').run('last_build_commit', currentCommit);
  db.prepare('INSERT OR REPLACE INTO build_metadata (key, value) VALUES (?, ?)').run('last_build_timestamp', new Date().toISOString());
  
  return { incremental: true, changes: changedFiles.length, files: changedFiles };
}
```

**Integration with forge-tools.cjs:**
```bash
# Default: incremental (falls back to full if needed)
node forge-cli/bin/forge-tools.cjs graph init

# Force full rebuild
node forge-cli/bin/forge-tools.cjs graph init --full
```

The `graph init` command in `forge-tools.cjs` calls `buildGraph()`. Change it to call `buildIncremental()` by default, with `--full` flag to force `buildGraph()`.

**Wave completion integration:**
In `execute-phase.md`, after each wave, the workflow calls `graph init` to refresh the graph. This now uses incremental mode, only re-parsing files that the wave's agents actually changed.

### Testing

1. Unit test: `buildIncremental()` on a clean DB (no `build_metadata`) falls back to full `buildGraph()`
2. Unit test: After full build + commit, changing 1 file and running incremental only re-parses that 1 file
3. Unit test: Deleting a file and running incremental removes its entries from all tables
4. Integration test: Full build → change 3 files → incremental build → verify `graph.db` matches a fresh full build
5. Performance test: Full build on 1000-file repo (~30s) vs incremental on 3 changed files (~<2s)
6. Schema migration test: Change `CURRENT_SCHEMA_VERSION` → verify incremental falls back to full rebuild

---

## IMP-06: Sub-Agent Summary Compression Protocol

### Problem

Agent results flow back as full execution traces. The `forge-agents/factory.js` already defines an output format (JSON in `` ```json:agent-output ``` `` block at line ~approx 145 with fields: `findings`, `decisions_made`, `files_created`, `files_modified`, `confidence`), but enforcement is inconsistent. The codebase-mapper agents correctly return only ~10-line confirmations, but executors and verifiers return full traces.

### Architecture

**Files to modify:**
- `.codex/agents/forge-executor.instructions.md` — add explicit output compression rule
- `.codex/agents/forge-verifier.instructions.md` — add summary output requirement
- `.codex/agents/forge-phase-researcher.instructions.md` — enforce summary return
- `forge-cli/workflows/execute-phase.md` — enforce summary consumption in wave orchestration
- `forge-agents/factory.js` — add `max_return_tokens` to agent config

**Standard return format (add to each agent's instructions):**

```markdown
## Return Protocol (MANDATORY)
When your work is complete, your FINAL message must contain ONLY a structured summary.
Do NOT return full file contents, conversation history, or reasoning chains.

Return format (max 2,000 tokens):
\`\`\`json:agent-output
{
  "status": "completed|failed|blocked",
  "files_created": ["path1", "path2"],
  "files_modified": ["path3"],
  "decisions_made": [{"decision": "...", "rationale": "..."}],
  "warnings": ["..."],
  "findings": ["..."],
  "confidence": 0.95,
  "summary": "One paragraph describing what was done and why."
}
\`\`\`
```

**Factory.js enhancement:**
Add `max_return_tokens: 2000` to the agent config object. This is advisory (Claude Code doesn't enforce output limits natively), but the instruction in the agent prompt is what drives compliance.

**Orchestrator consumption change (execute-phase.md):**
In the wave execution loop, when collecting agent results:
```markdown
## Per-agent result collection
1. Read the agent's final message
2. Extract the json:agent-output block
3. If no structured output found, extract: files in git diff + last 500 chars of output
4. Pass ONLY the extracted summary to the next wave's knowledge propagation
5. Do NOT inject full agent conversation into orchestrator context
```

### Testing

1. Prompt test: Spawn forge-executor with the new instructions, verify output contains `json:agent-output` block
2. Size test: Verify agent return is under 2,000 tokens (parse and count)
3. Integration test: Execute a 3-wave phase, verify orchestrator context stays under 50K tokens after all waves (vs. current ~150K+)
4. Quality test: Verify knowledge propagation (wave N warnings → wave N+1 context) still works with compressed summaries

---

## IMP-07: Structured Audit Trail

### Problem

Session ledger (`forge-session/ledger.js`) is human-readable markdown, not machine-parseable for enterprise governance tools.

### Architecture

**Files to create:**
- `forge-cli/lib/audit.cjs` — audit trail module

**Files to modify:**
- `forge-session/ledger.js` — add dual-write to audit.jsonl alongside ledger.md
- `forge-cli/bin/forge-tools.cjs` — add `audit` subcommand

**Audit event schema:**
```javascript
// forge-cli/lib/audit.cjs
const AUDIT_SCHEMA = {
  version: 1,
  event_type: '', // agent_spawned | plan_executed | verification_passed | verification_failed | 
                  // decision_made | requirement_completed | gap_found | fix_applied | 
                  // phase_started | phase_completed | wave_started | wave_completed
  timestamp: '',  // ISO-8601
  phase: null,    // number
  plan: null,     // string (plan ID)
  wave: null,     // number
  agent: '',      // agent type (forge-executor, forge-verifier, etc.)
  model: '',      // model used (opus, sonnet, haiku)
  files_modified: [], // file paths
  decision: '',   // decision text (if event_type = decision_made)
  rationale: '',  // rationale (if decision)
  verification_result: null, // passed | failed | gaps_found
  tokens: { input: 0, output: 0, total: 0 },
  cost_usd: 0,
  duration_ms: 0,
  metadata: {},   // additional context
};

function appendAuditEvent(cwd, event) {
  const auditPath = path.join(cwd, '.forge', 'session', 'audit.jsonl');
  const line = JSON.stringify({ ...AUDIT_SCHEMA, ...event, timestamp: new Date().toISOString() });
  fs.appendFileSync(auditPath, line + '\n');
}
```

**Integration points (where to call `appendAuditEvent()`):**
1. `forge-session/ledger.js` → `logDecision()` (line ~varies) — emit `decision_made` event
2. `forge-session/ledger.js` → `logError()` — emit `fix_applied` event
3. `forge-session/ledger.js` → `updateState()` — emit `phase_started`/`phase_completed`
4. `forge-session/metrics.js` → `snapshotUnitMetrics()` (line 30) — emit `agent_spawned` with token data
5. Workflow `execute-phase.md` → wave start/end — emit `wave_started`/`wave_completed`
6. Workflow `execute-phase.md` → verification — emit `verification_passed`/`verification_failed`

**Export commands:**
```bash
node forge-cli/bin/forge-tools.cjs audit export --format csv > audit.csv
node forge-cli/bin/forge-tools.cjs audit export --format github-issue  # Markdown summary
node forge-cli/bin/forge-tools.cjs audit export --format json          # Array of events
node forge-cli/bin/forge-tools.cjs audit summary                       # Human-readable summary
node forge-cli/bin/forge-tools.cjs audit phase <N>                     # Events for specific phase
```

### Testing

1. Unit test: `appendAuditEvent()` appends valid JSONL to file
2. Unit test: Each line in audit.jsonl parses as valid JSON with required fields
3. Integration test: Run plan-phase + execute-phase → verify audit.jsonl contains events in chronological order
4. Export test: `audit export --format csv` produces valid CSV with correct column headers
5. Idempotency test: Same event appended twice has different timestamps and both appear

---

## IMP-08: Diff-Aware Verification

### Problem

`forge-verify/engine.js` runs all layers against all files. The `verifyAfterWave()` function (referenced in workflows) limits to layers 1-5 but doesn't scope checks to only changed files.

### Architecture

**File to modify:** `forge-verify/engine.js`

**Current verify function signature (line ~varies):**
```javascript
async function verify({ cwd, files, plan, dbPath, maxLayer, failFast, json }) {
```

**Enhanced signature:**
```javascript
async function verify({ cwd, files, plan, dbPath, maxLayer, failFast, json, changedOnly, baseRef }) {
```

**When `changedOnly = true`:**
```javascript
function getChangedFiles(cwd, baseRef) {
  const ref = baseRef || 'HEAD~1';
  try {
    const output = execSync(`git diff --name-only ${ref}`, { cwd, encoding: 'utf8' });
    return output.trim().split('\n').filter(Boolean);
  } catch { return null; } // Fallback to full scan if git fails
}
```

**Per-layer scoping:**
- Layer 0 (HASH_LOCK): Only check hash-locked files that are in `changedFiles` set
- Layer 1 (STRUCTURAL): Filter `filesToCheck` to only `changedFiles`
- Layer 2 (TYPE_COMPILE): Keep full `tsc --noEmit` (compiler needs full project anyway)
- Layer 3 (INTERFACE_CONTRACTS): Only check interfaces whose files are in `changedFiles`
- Layer 4 (DEPENDENCY): Only check import graph edges involving `changedFiles`
- Layer 5 (KEY_LINKS): Keep full check (key_links are cross-file by nature)
- Layer 6 (TESTS): Use graph query to find tests related to `changedFiles`:
  ```javascript
  const gq = require('../forge-graph/query');
  const relatedTests = gq.getTestsForFiles(cwd, changedFiles);
  ```
- Layer 14 (ENTROPY): Compare only `changedFiles` against snapshot
- Layer 15 (REGRESSION): Only compare tests that touch `changedFiles`

**Workflow integration:**
In `execute-phase.md`, the `verifyAfterWave()` call gets enhanced:
```markdown
After each wave, run:
  node forge-verify/engine.js --root . --changed-only --base-ref {pre_wave_commit} --layer 0-5 --max-loops 2
```

Full verification (`--layer 0-15`, no `--changed-only`) still runs at phase completion.

### Testing

1. Unit test: `getChangedFiles()` returns correct list after modifying 2 files
2. Unit test: STRUCTURAL layer with `changedOnly=true` only scans changed files
3. Integration test: Change 1 file in a 100-file project → verify STRUCTURAL runs on 1 file (not 100)
4. Integration test: Verify TESTS layer finds and runs tests related to changed files
5. Regression test: Full verification with `changedOnly=false` produces identical results to before

---

## IMP-09: Package Hallucination Guard

### Problem

Executor agents can generate `import` statements referencing packages that don't exist on npm/PyPI. This is a documented attack vector where attackers register malicious packages with AI-hallucinated names.

### Architecture

**File to modify:** `forge-verify/engine.js` — add sub-check within STRUCTURAL layer (layer 1)

**Implementation:**
```javascript
// Add to STRUCTURAL layer checks
async function checkPackageHallucination(cwd, files) {
  const issues = [];
  const packageJson = path.join(cwd, 'package.json');
  let knownDeps = new Set();
  
  if (fs.existsSync(packageJson)) {
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    knownDeps = new Set(Object.keys(allDeps));
  }
  
  // Also include Node.js built-in modules
  const builtins = new Set(require('module').builtinModules);
  
  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx') && !file.endsWith('.js') && !file.endsWith('.jsx')) continue;
    
    const content = fs.readFileSync(path.join(cwd, file), 'utf8');
    // Extract bare imports (not relative ./  or alias @/)
    const importRegex = /(?:import\s+.*?from\s+['"]|require\s*\(\s*['"])([^./'][^'"]*)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const pkg = match[1].startsWith('@') ? match[1].split('/').slice(0, 2).join('/') : match[1].split('/')[0];
      if (!knownDeps.has(pkg) && !builtins.has(pkg) && !builtins.has('node:' + pkg)) {
        // New dependency — verify it exists on npm
        try {
          execSync(`npm view ${pkg} version`, { timeout: 5000, encoding: 'utf8', stdio: 'pipe' });
        } catch {
          issues.push({
            file, package: pkg, severity: 'error',
            label: `Package "${pkg}" not found in package.json or npm registry — possible hallucination`,
            suggestion: `Verify this package exists. If it does: npm install ${pkg}. If not: use a real alternative.`,
          });
        }
      }
    }
  }
  return issues;
}
```

**Python support:**
```javascript
// For Python files, check against pip
const pipRegex = /^(?:from|import)\s+(\w+)/gm;
// Verify: pip index versions <pkg> 2>/dev/null
```

**Performance consideration:**
- Only run on NEW imports (not pre-existing ones) — compare against git diff
- Cache npm registry results in memory during a single verification run
- Timeout per npm view: 5s (prevents hanging on network issues)
- This check adds ~1-5s total, well within STRUCTURAL layer's <5s budget for typical diffs

**Configuration:**
Add to `forge-config/config.js` defaults:
```javascript
verification: {
  layers: {
    package_hallucination: true,  // Can be disabled if offline
  }
}
```

### Testing

1. Unit test: File importing `express` (exists on npm) → no issues
2. Unit test: File importing `nonexistent-fake-pkg-xyz123` → flagged as hallucination
3. Unit test: File importing `./local-module` (relative) → skipped (not a package)
4. Unit test: File importing `fs` (Node builtin) → skipped
5. Integration test: Executor generates code with one real and one fake package → verification catches the fake one
6. Offline test: With `package_hallucination: false` in config → check is skipped

---

## IMP-10: Explorer-Critic Pattern for High-Risk Phases

### Problem

Single candidate implementation per plan. For security, payment, and infrastructure phases, one attempt may produce "almost right" code that passes verification but has subtle issues.

### Architecture

**Files to modify:**
- `forge-cli/workflows/execute-phase.md` — add multi-candidate mode for `archetype: careful` plans
- `forge-agents/parallel-planner.js` — add candidate spawning logic
- `.codex/agents/forge-code-reviewer.instructions.md` — enhance with candidate comparison capability

**Trigger conditions:**
Multi-candidate mode activates when ALL of these are true:
1. Plan has `archetype: careful` (set by factory.js when risk is CRITICAL or HIGH)
2. Phase touches security, payment, or auth requirements (detected from requirement IDs)
3. Config `execution.multi_candidate` is enabled (default: `false`, opt-in)

**Execution flow:**
```
Standard:  Plan → Executor → Result → Review → Merge
                                          
Multi-candidate:
  Plan → Executor-A (emphasis: security)  → Result-A ─┐
       → Executor-B (emphasis: readability) → Result-B ─┤→ Critic → Best → Merge  
       → Executor-C (emphasis: performance) → Result-C ─┘
```

**Implementation in execute-phase.md:**
```markdown
## Multi-Candidate Execution (for careful plans)
When a plan has archetype=careful AND multi_candidate is enabled:

1. Create 3 worktrees for the same plan
2. Spawn 3 forge-executor agents with emphasis variants:
   - Variant A: Append to system prompt: "Prioritize security and defensive coding. Validate all inputs. Use parameterized queries. Apply principle of least privilege."
   - Variant B: Append to system prompt: "Prioritize code readability and maintainability. Use clear naming. Add defensive comments for non-obvious security decisions."
   - Variant C: Append to system prompt: "Prioritize robustness and error handling. Handle every error path. Add retry logic where appropriate."
3. Collect all 3 patches
4. Spawn forge-code-reviewer in "critic mode":
   - Input: all 3 patches + original plan
   - Task: Select best implementation OR synthesize best parts from each
   - Output: final patch to apply
5. Apply selected/synthesized patch
6. Run standard verification
```

**Config addition:**
```json
{
  "execution": {
    "multi_candidate": false,
    "multi_candidate_count": 3,
    "multi_candidate_trigger": "careful"
  }
}
```

### Testing

1. Unit test: Plan with `archetype: careful` + `multi_candidate: true` → triggers multi-candidate flow
2. Unit test: Plan with `archetype: general` → standard single-candidate flow
3. Integration test: Execute a payment-related plan in multi-candidate mode → verify 3 worktrees created
4. Quality test: Compare verification pass rate of multi-candidate vs single-candidate on a security-focused plan
5. Cost test: Verify cost is ~3x for multi-candidate plans (expected, documented trade-off)

---

## IMP-11: Progressive Context Loading

### Problem

Every agent spawn loads full CLAUDE.md (2.75K tokens) + full agent directives (1.1K tokens) + full agent instructions (200-5,000 tokens). Across 131 agents, ~525-786K tokens of boilerplate.

### Architecture

**Files to modify:**
- `forge-agents/factory.js` — modify `composeSystemPrompt()` (step 3 of the 7-step pipeline)
- `forge-cli/references/agent-directives.md` — split into tiers

**Tiered directive system:**

Split `agent-directives.md` (4,383 bytes, 11 rules) into three files:
```
forge-cli/references/directives-core.md      (~500 tokens) — Rules 3, 4, 9 (Senior Dev Override, Forced Verification, Edit Integrity)
forge-cli/references/directives-workflow.md   (~400 tokens) — Rules 1, 2, 5, 6 (graph queries, ledger reads, context loading, state management)
forge-cli/references/directives-safety.md     (~200 tokens) — Rules 7, 8, 10, 11 (git safety, security, no-skip rules)
```

**Factory.js modification (composeSystemPrompt):**
```javascript
function composeSystemPrompt(analysis, plan, archetype, cwd) {
  const parts = [];
  
  // Always include: core directives (500 tokens)
  parts.push(loadDirectivesTier('core'));
  
  // Include workflow directives only for long-running agents (executor, planner, debugger)
  if (['specialist', 'integrator', 'careful'].includes(archetype)) {
    parts.push(loadDirectivesTier('workflow'));
  }
  
  // Include safety directives only for agents that modify files
  if (analysis.tools?.includes('Write') || analysis.tools?.includes('Edit')) {
    parts.push(loadDirectivesTier('safety'));
  }
  
  // Agent-specific instructions (always included)
  parts.push(analysis.instructions);
  
  // ... rest of system prompt composition
}
```

**CLAUDE.md optimization:**
Move section-specific rules into path-scoped `.claude/rules/` files:
```
.claude/rules/forge-graph.md     — Rules specific to graph module work
.claude/rules/forge-verify.md    — Rules specific to verification
.claude/rules/forge-session.md   — Rules specific to session management
```

These load automatically when Claude Code works in those directories, but are NOT injected into spawned agents (agents get directives-core.md instead).

### Testing

1. Unit test: Validation agent (research-checker) gets only `directives-core.md` (~500 tokens, not ~1,100)
2. Unit test: Executor agent gets `directives-core.md` + `directives-workflow.md` + `directives-safety.md` (full set)
3. Token count test: Measure total directive tokens across 131 agents before/after — verify ~40% reduction
4. Quality test: Run full pipeline with tiered directives — verify no quality regression in plans or execution

---

## IMP-12: Ledger Write Batching

### Problem

`forge-session/ledger.js` uses `proper-lockfile` (5-retry spin, ~50ms backoff) for every write operation. All parallel worktree agents serialize on this single file, creating a bottleneck that grows linearly with parallelism.

### Architecture

**Files to modify:**
- `forge-session/ledger.js` — add batch mode
- `forge-containers/worktree-orchestrator.js` — use agent-scoped log files during execution
- `forge-cli/workflows/execute-phase.md` — add merge step after each wave

**Agent-scoped logging during execution:**
```javascript
// forge-session/ledger.js — new functions

function agentLogPath(cwd, agentId) {
  return path.join(cwd, '.forge', 'session', `agent-${agentId}.jsonl`);
}

function appendAgentLog(cwd, agentId, entry) {
  // No lock needed — each agent writes to its own file
  const logPath = agentLogPath(cwd, agentId);
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, JSON.stringify({
    ...entry,
    agent_id: agentId,
    timestamp: new Date().toISOString(),
  }) + '\n');
}

function mergeAgentLogs(cwd) {
  const sessionDir = path.join(cwd, '.forge', 'session');
  const agentLogs = fs.readdirSync(sessionDir).filter(f => f.startsWith('agent-') && f.endsWith('.jsonl'));
  
  if (agentLogs.length === 0) return;
  
  // Acquire lock ONCE for the merge
  const release = lockfile.lockSync(ledgerPath(cwd), { retries: 5, stale: 30000 });
  try {
    const ledgerContent = readLedger(cwd);
    
    for (const logFile of agentLogs) {
      const entries = fs.readFileSync(path.join(sessionDir, logFile), 'utf8')
        .split('\n').filter(Boolean).map(JSON.parse);
      
      for (const entry of entries) {
        // Apply each entry to the appropriate ledger section
        appendToSection(ledgerContent, entry);
      }
      
      // Delete the agent log after merge
      fs.unlinkSync(path.join(sessionDir, logFile));
    }
    
    writeLedger(cwd, ledgerContent);
  } finally {
    release();
  }
}
```

**Worktree orchestrator integration:**
In `forge-containers/worktree-orchestrator.js`, when preparing a worktree for an agent:
- Set environment variable `FORGE_AGENT_LOG_MODE=batch` + `FORGE_AGENT_ID={taskId}`
- Agent's ledger calls check this env var and route to `appendAgentLog()` instead of the lock-based write

**Wave completion merge:**
After each wave completes in `execute-phase.md`:
```markdown
## Post-wave: Merge agent logs
Run: node -e "require('./forge-session/ledger').mergeAgentLogs('.')"
This acquires the lock ONCE and merges all agent-{id}.jsonl files into ledger.md.
```

### Testing

1. Unit test: `appendAgentLog()` writes to agent-specific file without locking
2. Unit test: `mergeAgentLogs()` correctly merges 5 agent logs into ledger.md
3. Concurrency test: 8 agents writing to their own log files simultaneously — no corruption
4. Integration test: Run 3-wave phase with 4 parallel agents per wave — verify ledger.md contains all entries after merge
5. Cleanup test: After merge, all `agent-*.jsonl` files are deleted

---

## IMP-13: Graph-Informed Token Estimation

### Problem

`forge-assess/assessor.js` uses `800 chars/file` as a fixed multiplier for graph context tokens (line ~varies in the estimation functions). Interface-heavy files are underestimated; small utility files are overestimated.

### Architecture

**File to modify:** `forge-assess/assessor.js`

**Current estimation (approximate):**
```javascript
function estimatePlanTokens(plan, cwd) {
  const fileTokens = plan.files.length * 800; // Fixed multiplier
  // ...
}
```

**New estimation using graph data:**
```javascript
function estimatePlanTokens(plan, cwd) {
  let fileTokens = 0;
  const gq = graphQuery(); // Lazy-loaded graph query module
  
  for (const file of plan.files) {
    // Try graph-informed estimate first
    const fileInfo = gq.getFileInfo(cwd, file);
    if (fileInfo) {
      // Graph-informed: symbol count * 50 tokens + line count * 4 tokens
      const symbolTokens = (fileInfo.symbol_count || 0) * 50;
      const lineTokens = (fileInfo.line_count || 0) * 4;
      fileTokens += Math.max(symbolTokens, lineTokens, 200); // Minimum 200 tokens
    } else {
      // Fallback: read actual file size
      try {
        const stat = fs.statSync(path.join(cwd, file));
        fileTokens += Math.ceil(stat.size / CHARS_PER_TOKEN);
      } catch {
        fileTokens += 800; // Ultimate fallback
      }
    }
  }
  
  return fileTokens;
}
```

**Graph query addition (`forge-graph/query.js`):**
```javascript
function getFileInfo(cwd, filePath) {
  const db = openDB(cwd);
  if (!db) return null;
  const row = db.prepare(`
    SELECT f.line_count, COUNT(s.id) as symbol_count 
    FROM files f 
    LEFT JOIN symbols s ON s.file_id = f.id 
    WHERE f.file_path = ? 
    GROUP BY f.id
  `).get(filePath);
  return row || null;
}
```

### Testing

1. Unit test: File with 50 symbols and 200 lines → estimate ~2,300 tokens (not flat 800)
2. Unit test: File with 2 symbols and 10 lines → estimate ~200 tokens (minimum, not 800)
3. Unit test: File not in graph → falls back to file size / 4
4. Integration test: Run assessor on a real plan → verify estimates are within 30% of actual token usage
5. Comparison test: Before/after split decisions for 10 sample plans — verify fewer unnecessary splits

---

## IMP-14: GitHub Actions Integration

### Problem

Forge is entirely human-invoked via terminal commands. Enterprise teams need CI/CD-triggered agent execution.

### Architecture

**Files to create:**
- `forge-ci-action/action.yml` — GitHub Action definition
- `forge-ci-action/entrypoint.sh` — Action entrypoint script
- `forge-ci-action/README.md` — Usage documentation

**action.yml:**
```yaml
name: 'Forge CI Action'
description: 'Run Forge SDLC automation commands in CI/CD pipelines'
inputs:
  command:
    description: 'Forge command to run (verify-work, plan-phase, add-tests, etc.)'
    required: true
  phase:
    description: 'Phase number (if applicable)'
    required: false
  anthropic-api-key:
    description: 'Anthropic API key'
    required: true
  forge-profile:
    description: 'Model profile (quality/balanced/budget)'
    required: false
    default: 'balanced'
  args:
    description: 'Additional arguments to pass to forge-tools.cjs'
    required: false
    default: ''

runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
    
    - name: Install Forge
      shell: bash
      run: |
        cd ${{ github.workspace }}
        npm install --prefix .forge-ci better-sqlite3 proper-lockfile yaml tree-sitter
    
    - name: Run Forge Command
      shell: bash
      env:
        ANTHROPIC_API_KEY: ${{ inputs.anthropic-api-key }}
        FORGE_MODEL_PROFILE: ${{ inputs.forge-profile }}
      run: |
        node forge-cli/bin/forge-tools.cjs ${{ inputs.command }} ${{ inputs.phase }} ${{ inputs.args }}
```

**Supported CI triggers:**
```yaml
# Example: .github/workflows/forge-verify.yml
name: Forge Verification
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./forge-ci-action
        with:
          command: 'verify work'
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Security constraints:**
- CI mode is read-only by default (verification, analysis)
- Write operations (execute-phase) require explicit `allow-writes: true` input
- API key is passed via secrets, never logged
- Output is captured to `$GITHUB_STEP_SUMMARY` for PR comments

### Testing

1. Action test: Run action locally with `act` tool → verify Forge command executes
2. Integration test: PR opened → verify-work runs → results posted as PR comment
3. Security test: Verify API key is not exposed in action logs
4. Failure test: Verify action fails gracefully when Forge command fails (exit code propagation)

---

## IMP-15: Speculative Verify-Fix Execution

### Problem

The verify→fix→re-verify loop in `forge-verify/loop.js` runs strictly sequentially. The PASTE research (arXiv 2603.18897, March 2026) demonstrates 48.5% task time reduction for predictable tool sequences.

### Architecture

**File to modify:** `forge-verify/loop.js`

**Current flow (sequential):**
```
Verify ALL → Fix failed → Verify ALL → Fix failed → ... (max 3 loops)
```

**Proposed flow (speculative parallel):**
```
Verify ALL → Fix failed layers → [speculative: verify untouched files] → 
  Fix completes → Verify ONLY fix-touched files → Merge speculative + targeted results
```

**Implementation:**
```javascript
async function verifyLoopSpeculative({ cwd, files, plan, maxLoops = 3 }) {
  let loopCount = 0;
  
  while (loopCount < maxLoops) {
    // Step 1: Full verify
    const result = await engine().verify({ cwd, files, plan });
    if (result.overall === 'passed') return result;
    
    // Step 2: Identify fixable failures
    const fixableLayers = result.layers.filter(l => !l.passed && AUTO_FIXABLE_LAYERS.has(l.name));
    if (fixableLayers.length === 0) return result; // Human-only failures
    
    // Step 3: Start fix agent
    const fixPromise = spawnFixAgent(cwd, fixableLayers, plan);
    
    // Step 4: SPECULATIVE — while fix runs, pre-verify untouched files
    // Identify files NOT likely to be changed by the fix (files without errors)
    const errorFiles = new Set(fixableLayers.flatMap(l => l.issues?.map(i => i.file) || []));
    const untouchedFiles = files.filter(f => !errorFiles.has(f));
    
    let speculativeResult = null;
    if (untouchedFiles.length > 0) {
      // Run structural + dependency checks on untouched files in parallel with fix
      speculativeResult = await engine().verify({
        cwd, files: untouchedFiles, plan,
        maxLayer: 5, // Only fast layers
      });
    }
    
    // Step 5: Fix completes — verify ONLY the files it changed
    const fixResult = await fixPromise;
    const fixChangedFiles = fixResult.files_modified || [];
    
    // Step 6: Targeted verify on fix-changed files
    const targetedResult = await engine().verify({
      cwd, files: fixChangedFiles, plan,
    });
    
    // Step 7: Merge results
    // - Speculative results for untouched files are valid (they didn't change)
    // - Targeted results for fix-changed files replace old results
    // - If any speculative file was actually changed by fix, discard speculative and re-verify
    const invalidSpeculative = fixChangedFiles.filter(f => untouchedFiles.includes(f));
    if (invalidSpeculative.length > 0 && speculativeResult) {
      // Some speculation was invalidated — re-verify those files
      const reVerify = await engine().verify({
        cwd, files: invalidSpeculative, plan, maxLayer: 5,
      });
      // Merge reVerify into speculative results
    }
    
    loopCount++;
  }
  
  return escalate(cwd, plan);
}
```

**Key safety invariant:** Speculative results are ONLY used for files that the fix agent did NOT modify. If a file was speculatively verified AND then modified by the fix agent, the speculative result is discarded and a fresh verification runs.

### Testing

1. Unit test: Fix agent changes file A → speculative result for file B is kept, result for A is discarded
2. Unit test: Fix agent changes no files → all speculative results are kept
3. Performance test: Compare wall-clock time of sequential vs speculative on a 5-file fix scenario
4. Safety test: Fix agent unexpectedly modifies a speculatively-verified file → verify re-verification triggers
5. Integration test: Full phase execution with speculative loop → verify final result matches sequential loop result

---

## Testing Strategy

### Test Infrastructure

All tests reside in `tests/improvements/` with the following structure:
```
tests/improvements/
  imp-01-model-tiering/
    test-model-resolution.js
    test-profile-override.js
  imp-02-token-dashboard/
    test-metrics-summary.js
    test-estimate-accuracy.js
    test-budget-warning.js
  imp-03-assessor-context/
    test-context-limit.js
    test-split-decisions.js
  imp-04-spec-quality-gate/
    test-requirement-validation.js
    test-gate-blocking.js
    test-force-override.js
  imp-05-incremental-graph/
    test-incremental-build.js
    test-schema-migration.js
    test-diff-detection.js
  imp-06-summary-compression/
    test-output-format.js
    test-token-measurement.js
  imp-07-audit-trail/
    test-event-schema.js
    test-jsonl-append.js
    test-export-formats.js
  imp-08-diff-aware-verify/
    test-changed-file-detection.js
    test-layer-scoping.js
  imp-09-package-guard/
    test-hallucination-detection.js
    test-builtin-exclusion.js
    test-registry-check.js
  imp-10-explorer-critic/
    test-trigger-conditions.js
    test-candidate-spawning.js
  imp-11-progressive-context/
    test-directive-tiers.js
    test-token-reduction.js
  imp-12-ledger-batching/
    test-agent-log.js
    test-merge-correctness.js
    test-concurrent-writes.js
  imp-13-token-estimation/
    test-graph-informed-estimate.js
    test-fallback-behavior.js
  imp-14-github-actions/
    test-action-yaml.js
    test-entrypoint.js
  imp-15-speculative-verify/
    test-speculation-safety.js
    test-result-merge.js
    test-performance.js
```

### End-to-End Validation

After all improvements are implemented, run the full pipeline on a test project:

```bash
# 1. Create a test project (small: 3 phases, ~12 requirements)
/forge-new-project  # SaaS task manager (minimal)

# 2. Verify model tiering is active
grep -r "model:" .forge/session/metrics.json  # Should show haiku/sonnet/opus mix

# 3. Verify token dashboard works
node forge-cli/bin/forge-tools.cjs metrics estimate 1

# 4. Verify spec quality gate
node forge-cli/bin/forge-tools.cjs requirements validate-phase 1

# 5. Run phase 1 through full pipeline
/forge-discuss-phase 1
/forge-plan-phase 1
/forge-execute-phase 1
/forge-verify-work 1

# 6. Verify incremental graph
node forge-cli/bin/forge-tools.cjs graph init  # Should say "incremental"

# 7. Verify audit trail
cat .forge/session/audit.jsonl | wc -l  # Should have events

# 8. Verify metrics
node forge-cli/bin/forge-tools.cjs metrics summary

# 9. Compare cost against baseline (pre-improvement)
# Target: 35-50% cost reduction for Tier 1 improvements
```

### Regression Testing

After each improvement, run the existing test suite:
```bash
npx tsc --noEmit                          # Type check
node forge-verify/engine.js --root . --json  # Self-verify
node forge-graph/query.js cycles           # No new circular deps
```

---

## Implementation Order & Dependencies

```
Phase 1 (Tier 1 — Quick Wins, no dependencies between them):
  IMP-01: Model Tiering          ─── standalone (TOML changes only)
  IMP-02: Token Dashboard        ─── standalone (new CLI command)
  IMP-03: Assessor Context Fix   ─── standalone (1-line fix)
  IMP-04: Spec Quality Gate      ─── standalone (new gate in workflow)

Phase 2 (Tier 2 — Medium effort, some dependencies):
  IMP-05: Incremental Graph      ─── standalone (builder.js enhancement)
  IMP-06: Summary Compression    ─── standalone (agent instruction changes)
  IMP-07: Audit Trail            ─── depends on IMP-02 (uses metrics data)
  IMP-08: Diff-Aware Verify      ─── depends on IMP-05 (uses graph query for test discovery)
  IMP-09: Package Guard          ─── standalone (verification layer addition)

Phase 3 (Tier 3 — Medium-Hard, depends on Phase 2):
  IMP-10: Explorer-Critic        ─── depends on IMP-01 (model tiering for cost control)
  IMP-11: Progressive Context    ─── depends on IMP-06 (summary protocol defines what's needed)
  IMP-12: Ledger Batching        ─── standalone (session module change)
  IMP-13: Token Estimation       ─── depends on IMP-05 (uses graph data)

Phase 4 (Tier 4 — Strategic, depends on Phase 1-2):
  IMP-14: GitHub Actions         ─── depends on IMP-07 (audit trail for CI output)
  IMP-15: Speculative Verify     ─── depends on IMP-08 (diff-aware scoping)
```

**Estimated implementation effort:**
- Phase 1: 1-2 days (4 improvements, all simple)
- Phase 2: 3-5 days (5 improvements, medium complexity)
- Phase 3: 3-4 days (4 improvements, requires testing)
- Phase 4: 2-3 days (2 improvements, new infrastructure)
- **Total: 9-14 days**
