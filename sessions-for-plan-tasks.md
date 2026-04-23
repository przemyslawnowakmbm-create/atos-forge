# Forge Remediation — Session Task Mapping

**Generated:** 2026-04-23
**Source:** implementation-plan.md (37 tasks, 5 phases)

---

## Execution Order Matrix

```
Wave 1:  [S1.1]                                          ← Sequential (Phase 1)
         ──── GATE: Phase 1 verified ────
Wave 2:  [S2.1] [S2.2] [S2.3] [S2.4] [S2.5] [S2.6]     ← Parallel (Phase 2, batch 1)
         [S2.7] [S2.8] [S2.9] [S2.10] [S2.11] [S2.12]   ← Parallel (Phase 2, batch 2)
         [S2.13]                                          ← Parallel (Phase 2, batch 3)
         ──── GATE: Phase 2 verified ────
Wave 3:  [S3.1] [S3.2] [S3.3] [S3.4] [S3.5]             ← Parallel (Phase 3, batch 1)
         [S3.6] [S3.7] [S3.8] [S3.9] [S3.10]            ← Parallel (Phase 3, batch 2)
         ──── GATE: Phase 3 verified ────
Wave 4:  [S4.1] [S4.2] [S4.3] [S4.4] [S4.5] [S4.6]     ← Parallel (Phase 4, batch 1)
         [S4.7] [S4.8] [S4.9] [S4.10] [S4.11]           ← Parallel (Phase 4, batch 2)
         ──── GATE: Phase 4 verified ────
Wave 5:  [S5.1] → [S5.2]                                 ← Sequential (Phase 5)
```

**Critical Path:** S1.1 → S3.2 → S4.5 → S5.2
**Total Sessions:** 37
**Max Parallel Width:** 13 (Wave 2)

---

## Wave 1 — Foundation (Sequential)

### Session S1.1: Replace regex YAML parser (T1.1)

- **Phase:** 1
- **Tasks:** T1.1
- **Blocked by:** None
- **Blocks:** S2.1, S3.1-S3.10

**Input files:**
- `forge-assess/assessor.js`
- `atos-forge/bin/lib/frontmatter.cjs`
- `package.json`

**Output files:**
- `forge-assess/assessor.js` (modified)
- `atos-forge/bin/lib/frontmatter.cjs` (modified)
- `forge-assess/package.json` (created)
- `package.json` (modified)

**Instructions:**
1. Add `yaml` (^2.6.0) to root `package.json` dependencies
2. Create `forge-assess/package.json` with yaml dependency
3. Run `npm install --no-audit --no-fund`
4. In `forge-assess/assessor.js`, replace the regex YAML parsing block (lines 93-124) with:
   - `const YAML = require('yaml');`
   - Replace waveMatch/depsMatch/autoMatch regex with `YAML.parse(fmMatch[1])`
   - Set `plan.frontmatter = { wave: parsed.wave ?? 1, depends_on: Array.isArray(parsed.depends_on) ? parsed.depends_on : [], autonomous: parsed.autonomous !== false, ...parsed }`
   - Set `plan.files_modified` from parsed.files_modified (array or string→array)
5. In `atos-forge/bin/lib/frontmatter.cjs`, replace `parseMustHavesBlock` indent parser with YAML.parse approach
6. Update `extractFrontmatter` to use YAML.parse and return full parsed object

**Verification:**
```bash
npm install --no-audit --no-fund
node -e "const YAML=require('yaml'); console.log('yaml loaded');"
node -e "const a=require('./forge-assess/assessor.js'); console.log(typeof a.parsePlan);"
```

---

## Wave 2 — Core Fixes (All Parallel)

### Session S2.1: Task type attributes + objective tags (T2.1)

- **Phase:** 2
- **Blocked by:** S1.1
- **Blocks:** None

**Input files:** `forge-assess/assessor.js` (lines 127-157)
**Output files:** `forge-assess/assessor.js` (modified)

**Instructions:**
1. Read `forge-assess/assessor.js` — locate task regex (~line 127)
2. Replace `/<task>([\s\S]*?)<\/task>/g` with `/<task\b[^>]*>([\s\S]*?)<\/task>/g`
3. Inside task-parsing loop, add type extraction: `const typeMatch = taskMatch[0].match(/<task\b[^>]*\btype="([^"]+)"/);`
4. Add name extraction: `const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);`
5. Include type and name in pushed task object
6. For objective (~line 156), add XML tag support: check `<objective>` tag first, fallback to `## Objective` markdown

**Verification:**
```bash
node -e "
const fs=require('fs');
fs.writeFileSync('/tmp/test-plan.md','---\nwave: 1\n---\n<task type=\"auto\"><files>f.js</files><action>fix</action></task>\n<objective>Test obj</objective>');
const a=require('./forge-assess/assessor.js');
const p=a.parsePlan('/tmp/test-plan.md');
console.log('type:', p.tasks[0]?.type, 'obj:', p.objective?.substring(0,8));
"
```

---

### Session S2.2: Key-link source-only matching (T2.2)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:** `atos-forge/bin/lib/verify.cjs` (lines 260-274)
**Output files:** `atos-forge/bin/lib/verify.cjs` (modified)

**Instructions:**
1. Read `atos-forge/bin/lib/verify.cjs` — find the `cmdVerifyKeyLinks` function
2. In the pattern matching else-if block (lines 260-274), remove the target fallback
3. Pattern should ONLY test against `sourceContent`, never `targetContent`
4. Delete lines that read targetContent and test pattern against it

**Verification:**
```bash
grep -c "targetContent" atos-forge/bin/lib/verify.cjs
# Should return 0 or only non-pattern-matching uses
```

---

### Session S2.3: BEHAVIORAL must_check fix (T2.3)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:** `forge-verify/engine.js` (lines 835-873)
**Output files:** `forge-verify/engine.js` (modified)

**Instructions:**
1. Read `forge-verify/engine.js` — locate layerBehavioral function and must_check handling (~lines 835-873)
2. Replace the keyword heuristic (`const keyword = check.toLowerCase().split(' ').find(...)`) with structured handling
3. String-form entries: skip with `skipped: true` and warning message
4. Object-form entries with `files` and `pattern`: read files, test regex, report pass/fail
5. Entries without files/pattern: skip with explanation

**Verification:**
```bash
node -e "require('./forge-verify/engine.js'); console.log('engine loads');"
```

---

### Session S2.4: Splitter test mode tmpdir (T2.4)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:** `forge-assess/splitter.js` (lines 1060-1296)
**Output files:** `forge-assess/splitter.js` (modified)

**Instructions:**
1. Read `forge-assess/splitter.js` — locate test mode section (~lines 1060-1296)
2. Add `const os = require('os');` at top if not present
3. Replace `path.join(cwd, f)` synthetic file writes with `path.join(os.tmpdir(), 'forge-splitter-test', f)`
4. Replace dangerous `fs.rmSync(srcDir, { recursive: true, force: true })` at ~line 1293 with targeted cleanup of only the tmpdir
5. Wrap in try/finally for cleanup

**Verification:**
```bash
node -e "require('./forge-assess/splitter.js'); console.log('splitter loads');"
```

---

### Session S2.5: Debug template definition (T2.5)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** S4.4

**Input files:** `atos-forge/workflows/diagnose-issues.md`
**Output files:** `atos-forge/workflows/diagnose-issues.md` (modified)

**Instructions:**
1. Read `atos-forge/workflows/diagnose-issues.md` — find where debug-subagent-prompt is referenced
2. Add the full template definition before the spawn step with all 8 placeholders: goal, truth, expected, actual, errors, reproduction, timeline, slug
3. Include clear instructions for the debug agent

**Verification:**
```bash
grep -c "debug-subagent-prompt" atos-forge/workflows/diagnose-issues.md
```

---

### Session S2.6: Plan completion integrity (T2.6)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:**
- `atos-forge/bin/lib/core.cjs` (lines 256-262)
- `atos-forge/bin/lib/phase.cjs` (lines 193-236)

**Output files:** Both files (modified)

**Instructions:**
1. Create `isPlanComplete(summaryPath)` function that checks:
   - File exists
   - Contains "Self-Check: PASSED"
   - No `tests_failed: [1-9]` in frontmatter
2. Use this function in core.cjs completedPlanIds
3. Use this function in phase.cjs hasSummary checks

**Verification:**
```bash
node -e "require('./atos-forge/bin/lib/core.cjs'); console.log('core loads');"
```

---

### Session S2.7: Executor Rule 1 scope (T2.7)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:** `agents/forge-executor.md` (lines 100-112)
**Output files:** `agents/forge-executor.md` (modified)

**Instructions:**
1. Read `agents/forge-executor.md` — find Rule 1 section
2. Add explicit prohibition: "Rule 1 modifies implementation code only. To modify a test file (*.test.*, *.spec.*, __tests__/*), raise a checkpoint:decision and wait for user approval."
3. Add: "Tests written by the test-author wave are the contract — implementation must meet them, not the other way around. Never silently rewrite a failing test to make it pass."

**Verification:**
```bash
grep "implementation code only" agents/forge-executor.md
```

---

### Session S2.8: Ledger write protection (T2.8)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:** `forge-session/ledger.js` (line 148 writeRaw, line 184 appendToSection)
**Output files:**
- `forge-session/ledger.js` (modified)
- `package.json` (modified — add proper-lockfile)

**Instructions:**
1. Add `proper-lockfile` to root `package.json` dependencies
2. Run `npm install --no-audit --no-fund`
3. In ledger.js, require proper-lockfile
4. Wrap `writeRaw` with lockfile.lockSync/release pattern
5. Wrap `appendToSection` with same lock pattern (read+modify+write must be atomic)

**Verification:**
```bash
npm ls proper-lockfile 2>/dev/null | grep proper-lockfile
node -e "require('./forge-session/ledger.js'); console.log('ledger loads');"
```

---

### Session S2.9: Crash-recovery boot time (T2.9)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:** `forge-session/crash-recovery.js` (lines 43-52)
**Output files:** `forge-session/crash-recovery.js` (modified)

**Instructions:**
1. Add `const os = require('os');` if not present
2. Add `getBootTime()` function: `Math.floor(Date.now() / 1000) - os.uptime()`
3. In `readCrashLock`, compare lock's startedAt epoch against boot time
4. If lock is from before last reboot, set `processAlive = false` without PID check
5. Otherwise, proceed with existing PID check

**Verification:**
```bash
node -e "require('./forge-session/crash-recovery.js'); console.log('crash-recovery loads');"
```

---

### Session S2.10: Context-monitor fallback (T2.10)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:** `hooks/forge-context-monitor.js` (lines 51-53)
**Output files:** `hooks/forge-context-monitor.js` (modified)

**Instructions:**
1. Find the stale metrics handling (lines 51-53 with `process.exit(0)`)
2. Replace with transcript-size estimation: `Math.ceil(inputLen / 4)` for token estimate
3. Log WARNING at 65%, CRITICAL at 75% of 200K context window
4. Do NOT exit — continue monitoring

**Verification:**
```bash
grep -c "process.exit(0)" hooks/forge-context-monitor.js
# Should be 0 in the stale-metrics branch
```

---

### Session S2.11: Slim planner prompt (T2.11)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:** `agents/forge-planner.md` (1277 lines)
**Output files:**
- `agents/forge-planner.md` (modified — slimmed)
- `atos-forge/references/planner-cookbook.md` (created)

**Instructions:**
1. Read full forge-planner.md in chunks
2. Identify extractable sections: worked examples, UI/UX specificity table, depth calibration tables
3. Move extracted content to `atos-forge/references/planner-cookbook.md`
4. Replace extracted sections with `@planner-cookbook.md` reference annotation
5. Ensure `atos-forge/references/` directory exists

**Verification:**
```bash
wc -w agents/forge-planner.md
# Should be < 5000 words (down from ~11000)
ls atos-forge/references/planner-cookbook.md
```

---

### Session S2.12: Slim verifier/plan-checker prompts (T2.12)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:**
- `agents/forge-verifier.md` (755 lines)
- `agents/forge-plan-checker.md` (748 lines)

**Output files:**
- `agents/forge-verifier.md` (modified)
- `agents/forge-plan-checker.md` (modified)
- `atos-forge/references/verifier-cookbook.md` (created)

**Instructions:**
1. Read both agent files
2. Extract stub-detection patterns, worked examples, lengthy checklists
3. Move to `atos-forge/references/verifier-cookbook.md`
4. Replace with @reference annotations
5. Target: ~3K tokens each for base prompts

**Verification:**
```bash
wc -w agents/forge-verifier.md agents/forge-plan-checker.md
# Combined should drop by >= 3000 words
```

---

### Session S2.13: Researcher WebSearch budget (T2.13)

- **Phase:** 2
- **Blocked by:** None
- **Blocks:** None

**Input files:**
- `agents/forge-project-researcher.md`
- `agents/forge-phase-researcher.md`

**Output files:** Both files (modified)

**Instructions:**
1. Add "Tool Budget (mandatory)" section to both files
2. Include: WebSearch max 5 calls, WebFetch max 3 calls
3. Include priority order: Context7 > WebFetch > WebSearch
4. Include budget enforcement note

**Verification:**
```bash
grep "maximum 5 calls" agents/forge-project-researcher.md agents/forge-phase-researcher.md
```

---

## Wave 3 — Pipeline Upgrades (All Parallel)

### Session S3.1: Parent contract propagation (T3.1)

- **Phase:** 3
- **Blocked by:** S1.1
- **Blocks:** S4.1

**Input files:** `forge-assess/splitter.js` (lines 705-743)
**Output files:** `forge-assess/splitter.js` (modified)

**Instructions:**
1. In `buildSubPlan`, after constructing result object, attach parent_contract
2. Filter key_links and artifacts by sub-plan's file set
3. Include: objective, requirements, truths, filtered key_links, filtered artifacts, parent_must_haves_full
4. Update `formatSubPlanXML` to emit parent_contract into sub-plan YAML frontmatter
5. Update `formatSubPlanJSON` to include parent_contract

**Verification:**
```bash
node -e "require('./forge-assess/splitter.js'); console.log('splitter loads');"
```

---

### Session S3.2: Plan contract in system prompt (T3.2)

- **Phase:** 3
- **Blocked by:** S1.1
- **Blocks:** S4.5

**Input files:** `forge-agents/factory.js` (lines 431-684 composeSystemPrompt)
**Output files:** `forge-agents/factory.js` (modified)

**Instructions:**
1. After the LOCKED DECISIONS section (~line 626), add Plan Contract section
2. Include: objective, requirements, truths (numbered), artifacts (with properties), key_links (with patterns)
3. Also handle parent_contract for sub-plans
4. Add "Do NOT mark any task complete unless the wiring above is in place."

**Verification:**
```bash
node -e "require('./forge-agents/factory.js'); console.log('factory loads');"
grep "Plan Contract" forge-agents/factory.js
```

---

### Session S3.3: KEY_LINKS verification layer (T3.3)

- **Phase:** 3
- **Blocked by:** S1.1
- **Blocks:** S4.2, S4.3

**Input files:**
- `forge-verify/engine.js`
- `forge-config/config.js`

**Output files:** Both files (modified)

**Instructions:**
1. In engine.js, add `layerKeyLinks` function that reads plan, parses key_links, verifies each link's pattern in source file
2. Add 'KEY_LINKS' to LAYER_NAMES after 'DEPENDENCY'
3. Wire into verify() dispatcher
4. In config.js, add `key_links: true` to DEFAULTS.verification.layers
5. Update getVerification() mapping

**Verification:**
```bash
node -e "require('./forge-verify/engine.js'); console.log('engine loads');"
node -e "require('./forge-config/config.js'); const c=require('./forge-config/config.js'); console.log(c.loadConfig('.').config.verification.layers);"
```

---

### Session S3.4: Wave-to-wave findings bridge (T3.4)

- **Phase:** 3
- **Blocked by:** None
- **Blocks:** S4.1

**Input files:**
- `forge-agents/factory.js` (~line 1200)
- `forge-containers/worktree-orchestrator.js`
- `forge-containers/orchestrator.js`

**Output files:** All three files (modified)

**Instructions:**
1. In factory.js buildAgentConfig, accept opts.previousFindings and add to analysis
2. In extractSessionContext, include previousFindings in context
3. In worktree-orchestrator.js, after wave patches applied, collect findings and pass to next wave
4. Same for orchestrator.js

**Verification:**
```bash
node -e "require('./forge-agents/factory.js'); console.log('factory loads');"
node -e "require('./forge-containers/worktree-orchestrator.js'); console.log('worktree-orch loads');"
```

---

### Session S3.5: Extend cache key (T3.5)

- **Phase:** 3
- **Blocked by:** None
- **Blocks:** None

**Input files:** `forge-agents/cache.js` (lines 31-89)
**Output files:** `forge-agents/cache.js` (modified)

**Instructions:**
1. Add planning docs mtimes (REQUIREMENTS.md, ROADMAP.md, PROJECT.md, STATE.md)
2. Add FACTORY_VERSION constant ('v2.0')
3. Accept opts parameter, hash previousFindings if present
4. Update all callers to pass opts

**Verification:**
```bash
node -e "require('./forge-agents/cache.js'); console.log('cache loads');"
grep "FACTORY_VERSION" forge-agents/cache.js
```

---

### Session S3.6: Agent output validation (T3.6)

- **Phase:** 3
- **Blocked by:** None
- **Blocks:** None

**Input files:** `forge-agents/agent-output-schema.js`
**Output files:** `forge-agents/agent-output-schema.js` (modified)

**Instructions:**
1. Add REQUIRED_FIELDS constant: findings, decisions_made, files_created, files_modified, confidence
2. Add proper type checking for each field
3. Validate finding structure (type + description required)
4. Return { valid, issues, normalized }

**Verification:**
```bash
node -e "
const s = require('./forge-agents/agent-output-schema.js');
const r = s.validateOutput({});
console.log('valid:', r.valid, 'issues:', r.issues.length);
"
```

---

### Session S3.7: Common vocabulary reference (T3.7)

- **Phase:** 3
- **Blocked by:** None
- **Blocks:** None

**Input files:** Various agent .md files
**Output files:** `atos-forge/references/common-vocabulary.md` (created)

**Instructions:**
1. Create vocabulary file defining: must_haves, key_links, truths, artifacts, requirements, CONTEXT.md, STATE.md, SUMMARY.md, Phase Boundary, goal-backward, frontmatter, Locked Decisions, wave, archetype, parent_contract
2. Each term gets 1-2 sentence definition
3. Ensure `atos-forge/references/` directory exists

**Verification:**
```bash
ls atos-forge/references/common-vocabulary.md
grep -c "must_haves" atos-forge/references/common-vocabulary.md
```

---

### Session S3.8: Cap ledger inclusion (T3.8)

- **Phase:** 3
- **Blocked by:** None
- **Blocks:** None

**Input files:** `forge-agents/factory.js` (~line 1027)
**Output files:** `forge-agents/factory.js` (modified)

**Instructions:**
1. Add `const MAX_ENTRIES_PER_CATEGORY = 30;` near extractSessionContext
2. Apply `.slice(-MAX_ENTRIES_PER_CATEGORY)` to decisions, warnings, preferences, rejected arrays

**Verification:**
```bash
grep "MAX_ENTRIES_PER_CATEGORY" forge-agents/factory.js
```

---

### Session S3.9: Cache system prompt scaffold (T3.9)

- **Phase:** 3
- **Blocked by:** None
- **Blocks:** None

**Input files:** `forge-agents/factory.js` (composeSystemPrompt)
**Output files:** `forge-agents/factory.js` (modified)

**Instructions:**
1. Add `_promptScaffoldCache` variable
2. Compute scaffold cache key from archetype + sessionContext + capabilities
3. On cache hit, reuse scaffold and only rebuild plan-specific sections
4. On cache miss, build full prompt and cache scaffold portion

**Verification:**
```bash
grep "_promptScaffoldCache" forge-agents/factory.js
```

---

### Session S3.10: Skip cache for revision/fix agents (T3.10)

- **Phase:** 3
- **Blocked by:** None
- **Blocks:** None

**Input files:**
- `atos-forge/workflows/execute-phase.md`
- `atos-forge/workflows/plan-phase.md`

**Output files:** Both files (modified)

**Instructions:**
1. In execute-phase.md step 5d, add `--skip-cache` to fix-agent factory build
2. In plan-phase.md revision loop, add `--skip-cache` to revision planner factory build

**Verification:**
```bash
grep -c "skip-cache\|skipCache" atos-forge/workflows/execute-phase.md atos-forge/workflows/plan-phase.md
```

---

## Wave 4 — Integration (All Parallel)

### Session S4.1: Patch DAG ordering + conflict guard (T4.1)

- **Phase:** 4
- **Blocked by:** S3.1, S3.4
- **Blocks:** None

**Input files:**
- `forge-containers/patch-collector.js`
- `forge-containers/worktree-orchestrator.js`

**Output files:** Both files (modified)

**Instructions:**
1. Parse each patch's `diff --git a/... b/...` headers, build per-patch file sets
2. Assert no intersection between patches in same wave — fail fast with conflict error
3. Use parallel-planner dependency info for topological sort of patches
4. Add wave-level transaction: snapshot HEAD before wave, reset on failure

**Verification:**
```bash
node -e "require('./forge-containers/worktree-orchestrator.js'); console.log('loads');"
```

---

### Session S4.2: Per-wave fast verifier (T4.2)

- **Phase:** 4
- **Blocked by:** S3.3
- **Blocks:** None

**Input files:**
- `forge-verify/loop.js`
- `atos-forge/workflows/execute-phase.md`

**Output files:** Both files (modified)

**Instructions:**
1. Add `verifyAfterWave` function to loop.js — restricted to layers 1-5, max 2 loops
2. Export verifyAfterWave
3. In execute-phase.md step 5c/5d, replace inline tsc+eslint with verifyAfterWave call

**Verification:**
```bash
node -e "const l=require('./forge-verify/loop.js'); console.log(typeof l.verifyAfterWave);"
```

---

### Session S4.3: Code reviewer agent (T4.3)

- **Phase:** 4
- **Blocked by:** S3.3
- **Blocks:** None

**Input files:** `atos-forge/workflows/execute-phase.md`
**Output files:**
- `agents/forge-code-reviewer.md` (created)
- `atos-forge/workflows/execute-phase.md` (modified)

**Instructions:**
1. Create forge-code-reviewer.md agent that reads changed files + plan's must_haves + key_links
2. Agent returns issues if any artifact is a stub or any link is unwired
3. Uses balanced model profile (sonnet)
4. Wire into execute-phase.md after wave patches apply — cap at 2 review iterations per wave

**Verification:**
```bash
ls agents/forge-code-reviewer.md
grep "code-reviewer" atos-forge/workflows/execute-phase.md
```

---

### Session S4.4: Proper subagent_type for workflows (T4.4)

- **Phase:** 4
- **Blocked by:** S2.5
- **Blocks:** None

**Input files:**
- `atos-forge/workflows/plan-phase.md`
- `atos-forge/workflows/new-project.md`
- `atos-forge/workflows/quick.md`
- `atos-forge/workflows/diagnose-issues.md`

**Output files:** All four files (modified)

**Instructions:**
1. plan-phase.md: researcher → forge-phase-researcher, planner → forge-planner (find all sites)
2. new-project.md: 4 researchers → forge-project-researcher
3. quick.md: planner → forge-planner
4. diagnose-issues.md: debugger → forge-debugger

**Verification:**
```bash
grep -r 'subagent_type="general-purpose"' atos-forge/workflows/ | wc -l
# Should be 0
```

---

### Session S4.5: Auto mode factory integration (T4.5)

- **Phase:** 4
- **Blocked by:** S3.2, S3.3
- **Blocks:** None

**Input files:**
- `forge-auto/dispatcher.js`
- `forge-auto/auto.js`

**Output files:** Both files (modified)

**Instructions:**
1. In dispatcher.js "execute" unit: replace buildPrompt with factory.buildAgentConfig
2. Spawn via worktree orchestrator path
3. "plan" unit: use planner agent definition via proper subagent_type
4. "verify" unit: invoke verification engine with all layers
5. Remove truncate-to-4000-chars approach
6. Crash recovery: restart at same wave/agent, not entire phase

**Verification:**
```bash
node -e "require('./forge-auto/dispatcher.js'); console.log('dispatcher loads');"
grep "buildAgentConfig\|factory" forge-auto/dispatcher.js
```

---

### Session S4.6: Research integrity gate (T4.6)

- **Phase:** 4
- **Blocked by:** None
- **Blocks:** None

**Input files:** `atos-forge/workflows/plan-phase.md`
**Output files:**
- `agents/forge-research-checker.md` (created)
- `atos-forge/workflows/plan-phase.md` (modified)

**Instructions:**
1. Create forge-research-checker.md agent that validates RESEARCH.md structure
2. Checks confidence labels, primary source URLs for HIGH claims
3. Cross-references for contradictions
4. Add 2-iteration revision loop in plan-phase.md step 5
5. Add freshness check using valid_until from RESEARCH.md frontmatter

**Verification:**
```bash
ls agents/forge-research-checker.md
grep "research-checker" atos-forge/workflows/plan-phase.md
```

---

### Session S4.7: Test-author agent (T4.7)

- **Phase:** 4
- **Blocked by:** S1.1
- **Blocks:** None

**Input files:** `atos-forge/workflows/execute-phase.md`
**Output files:**
- `agents/forge-test-author.md` (created)
- `atos-forge/workflows/execute-phase.md` (modified)

**Instructions:**
1. Create forge-test-author.md that reads must_haves.truths, key_links, requirements
2. Writes one test per truth (tests fail against empty repo — intentional TDD)
3. Insert Wave 0 in execute-phase.md before implementation waves
4. Wave 0: test-author writes failing tests from truths
5. Wave 1..N: executor writes implementation

**Verification:**
```bash
ls agents/forge-test-author.md
grep -i "wave.0\|test.author" atos-forge/workflows/execute-phase.md
```

---

### Session S4.8: Truth-driven add-tests (T4.8)

- **Phase:** 4
- **Blocked by:** S1.1
- **Blocks:** None

**Input files:** `atos-forge/workflows/add-tests.md`
**Output files:** `atos-forge/workflows/add-tests.md` (modified)

**Instructions:**
1. Replace TDD/E2E/Skip classifier table with truth-to-test mapping
2. Read must_haves.truths from PLAN.md
3. For each truth without corresponding test, generate one
4. Fall back to classifier only if must_haves absent (legacy plans)

**Verification:**
```bash
grep "must_haves\|truths" atos-forge/workflows/add-tests.md
```

---

### Session S4.9: Codebase docs loading (T4.9)

- **Phase:** 4
- **Blocked by:** None
- **Blocks:** None

**Input files:** `atos-forge/bin/lib/init.cjs`
**Output files:** `atos-forge/bin/lib/init.cjs` (modified)

**Instructions:**
1. Add `codebaseDocsForPhaseType(cwd)` helper function
2. Scan `.planning/codebase/` for ARCHITECTURE.md, CONVENTIONS.md, STRUCTURE.md, TESTING.md, CONCERNS.md, INTEGRATIONS.md
3. Return as docs object with lowercase keys
4. Call from cmdInitPlanPhase when includes has 'codebase'

**Verification:**
```bash
grep "codebaseDocsForPhaseType" atos-forge/bin/lib/init.cjs
```

---

### Session S4.10: Summary-then-load for init (T4.10)

- **Phase:** 4
- **Blocked by:** None
- **Blocks:** None

**Input files:** `atos-forge/bin/lib/init.cjs`
**Output files:** `atos-forge/bin/lib/init.cjs` (modified)

**Instructions:**
1. Add `summarizeFile(filePath, maxLines=50)` function
2. Returns { path, total_lines, total_chars, summary, full_content_available }
3. Use summaries for files >200 lines
4. Sub-agents read full content via Read tool when needed

**Verification:**
```bash
grep "summarizeFile" atos-forge/bin/lib/init.cjs
```

---

### Session S4.11: Research provenance + refresh (T4.11)

- **Phase:** 4
- **Blocked by:** None
- **Blocks:** None

**Input files:** `agents/forge-requirement-enhancer.md`
**Output files:**
- `agents/forge-requirement-enhancer.md` (modified)
- `atos-forge/workflows/research-refresh.md` (created)

**Instructions:**
1. Add source_dimension and source_confidence to requirement-enhancer output YAML
2. Create /forge-research-refresh workflow that diffs valid_until against today
3. Diff package.json against research-time snapshot
4. Re-spawn only stale dimensions
5. Archive prior research to .planning/research/archive/{date}/

**Verification:**
```bash
ls atos-forge/workflows/research-refresh.md
grep "source_dimension" agents/forge-requirement-enhancer.md
```

---

## Wave 5 — Testing (Sequential)

### Session S5.1: Multi-runtime conversion tests (T5.1)

- **Phase:** 5
- **Blocked by:** All Wave 1-4 sessions
- **Blocks:** S5.2

**Input files:** All agent .md files in `agents/`
**Output files:** `tests/install-conversions.test.cjs` (created)

**Instructions:**
1. Create test file using Node.js built-in test runner
2. For each agent prompt x 3 runtimes (Codex, Opencode, Gemini) = 36+ cases
3. Assert: output non-empty, frontmatter parseable, ${VAR} patterns preserved, no tag content lost

**Verification:**
```bash
node --test tests/install-conversions.test.cjs
```

---

### Session S5.2: Requirements pipeline regression test (T5.2)

- **Phase:** 5
- **Blocked by:** S5.1
- **Blocks:** None

**Input files:** All modified modules
**Output files:** `tests/requirements-pipeline.test.cjs` (created)

**Instructions:**
1. Create end-to-end test file using Node.js built-in test runner
2. B1: parsePlan returns tasks, full frontmatter keys, non-empty objective
3. B2: factory output includes must_haves in frontmatter
4. B3: verify artifacts returns meaningful pass/fail
5. B4: engine returns FAIL for broken implementation
6. S4: file ownership conflict detected by patch applier
7. S5: stub implementation fails verification

**Verification:**
```bash
node --test tests/requirements-pipeline.test.cjs
```

---

## File Conflict Matrix

Sessions that touch the same file (must NOT run in same wave or must edit non-overlapping sections):

| File | Sessions | Conflict Risk |
|------|----------|---------------|
| `forge-assess/assessor.js` | S1.1, S2.1 | NONE — S2.1 waits for S1.1 (different waves) |
| `forge-assess/splitter.js` | S2.4, S3.1 | NONE — different waves |
| `forge-agents/factory.js` | S3.2, S3.4, S3.8, S3.9 | LOW — different functions (composeSystemPrompt vs buildAgentConfig vs extractSessionContext) |
| `forge-verify/engine.js` | S2.3, S3.3 | NONE — different waves |
| `atos-forge/workflows/execute-phase.md` | S3.10, S4.2, S4.3, S4.7 | LOW — S3.10 in Wave 3, rest in Wave 4 editing different steps |
| `atos-forge/workflows/plan-phase.md` | S3.10, S4.4, S4.6 | LOW — different sections |
| `atos-forge/bin/lib/init.cjs` | S4.9, S4.10 | MEDIUM — same file, same functions. Agent must handle both changes. |
| `package.json` | S1.1, S2.8 | NONE — different waves, different deps |

**Resolution for S4.9 + S4.10:** Combine into single agent session or ensure S4.9 completes first. Both add independent functions, so parallel is safe if edits target non-overlapping lines.
