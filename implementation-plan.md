# Forge Remediation — Implementation Plan

**Generated:** 2026-04-23
**Source:** architecture.md (36 fixes, 5 phases)
**Strategy:** Maximum parallelism with strict dependency gates

---

## Execution Overview

| Phase | Tasks | Execution | Dependencies | Est. Duration |
|-------|-------|-----------|--------------|---------------|
| 1 | 1 | Sequential | None | 10 min |
| 2 | 13 | All Parallel | None | 15 min |
| 3 | 10 | All Parallel | Phase 1 | 15 min |
| 4 | 11 | All Parallel | Phases 2+3 | 20 min |
| 5 | 2 | Sequential | All prior | 10 min |

**Total tasks:** 37 | **Critical path:** Phase 1 → Phase 3 → Phase 4 → Phase 5

---

## Phase 1: Foundation Parser (Sequential)

> **Gate:** Phase 2 and Phase 3 cannot start until Phase 1 verification passes.

### T1.1: Replace regex YAML parser with js-yaml

- **Objective:** Replace hand-rolled regex frontmatter parsing in `parsePlan` with proper YAML library so ALL frontmatter fields (must_haves, requirements, truths, key_links, artifacts) are preserved.
- **Complexity:** L (Large — multi-file, dependency addition, core parser rewrite)
- **Input files:**
  - `forge-assess/assessor.js` (lines 89-160 — parsePlan function)
  - `atos-forge/bin/lib/frontmatter.cjs` (lines 7-218 — parseMustHavesBlock, extractFrontmatter)
  - `package.json` (root dependencies)
- **Output files:**
  - `forge-assess/assessor.js` — MODIFY parsePlan (replace regex block lines 93-124 with YAML.parse)
  - `atos-forge/bin/lib/frontmatter.cjs` — MODIFY parseMustHavesBlock and extractFrontmatter
  - `forge-assess/package.json` — CREATE with yaml dependency
  - `package.json` — ADD yaml to root dependencies
- **Dependencies:** None
- **Success criteria:**
  ```bash
  npm install --no-audit --no-fund
  node -e "const YAML=require('yaml'); const fs=require('fs'); console.log('yaml loaded');"
  node -e "const a=require('./forge-assess/assessor.js'); console.log(typeof a.parsePlan);"
  ```
- **Risk:** Breaking existing parsePlan callers. Mitigate by preserving existing return shape (wave, depends_on, autonomous) via spread operator.

---

## Phase 2: Core Independent Fixes (All Parallel)

> **Gate:** All 13 tasks must pass verification before Phase 4 starts.
> **Parallelism:** ALL tasks run simultaneously — zero file overlap.

### T2.1: Parse task type attributes and objective tags (Fix 2)

- **Objective:** Support `<task type="auto">` syntax and `<objective>` XML tags in plan parsing
- **Complexity:** S
- **Input files:** `forge-assess/assessor.js` (lines 127-157)
- **Output files:** `forge-assess/assessor.js` — MODIFY task regex and objective extraction
- **Dependencies:** T1.1 (Phase 1 must complete — same file, YAML parser must be stable)
- **Success criteria:**
  ```bash
  node -e "
  const fs=require('fs');
  fs.writeFileSync('/tmp/test-plan.md','---\nwave: 1\n---\n<task type=\"auto\"><files>f.js</files><action>fix</action></task>\n<objective>Test obj</objective>');
  const a=require('./forge-assess/assessor.js');
  const p=a.parsePlan('/tmp/test-plan.md');
  console.log(p.tasks[0].type==='auto' && p.objective==='Test obj');
  "
  ```

### T2.2: Key-link patterns must match in source only (Fix 3)

- **Objective:** Remove false-positive target fallback in key-link verification
- **Complexity:** S
- **Input files:** `atos-forge/bin/lib/verify.cjs` (lines 260-274)
- **Output files:** `atos-forge/bin/lib/verify.cjs` — MODIFY pattern matching block
- **Dependencies:** None
- **Success criteria:** Pattern matching block no longer reads targetContent or tests against it.

### T2.3: Fix BEHAVIORAL must_check heuristic (Fix 7)

- **Objective:** Replace keyword heuristic with explicit files+pattern structure for must_check entries
- **Complexity:** M
- **Input files:** `forge-verify/engine.js` (lines 835-873)
- **Output files:** `forge-verify/engine.js` — MODIFY layerBehavioral must_check handling
- **Dependencies:** None
- **Success criteria:** String-form must_check entries are skipped with warning; object-form entries with files+pattern are properly verified.

### T2.4: Splitter test mode uses tmpdir (Fix 8)

- **Objective:** Fix test mode writing to cwd/src/ and dangerous cleanup of user src/ directory
- **Complexity:** M
- **Input files:** `forge-assess/splitter.js` (lines 1060-1296)
- **Output files:** `forge-assess/splitter.js` — MODIFY test mode paths
- **Dependencies:** None
- **Success criteria:**
  ```bash
  ls src/ > /tmp/before.txt 2>/dev/null || echo "none" > /tmp/before.txt
  node forge-assess/splitter.js --test --root . 2>/dev/null || true
  ls src/ > /tmp/after.txt 2>/dev/null || echo "none" > /tmp/after.txt
  diff /tmp/before.txt /tmp/after.txt
  ```

### T2.5: Debug template definition (Fix 15)

- **Objective:** Define the debug-subagent-prompt template in diagnose-issues.md
- **Complexity:** S
- **Input files:** `atos-forge/workflows/diagnose-issues.md` (~line 78)
- **Output files:** `atos-forge/workflows/diagnose-issues.md` — ADD template definition
- **Dependencies:** None
- **Success criteria:** `grep -c "debug-subagent-prompt" atos-forge/workflows/diagnose-issues.md` returns >= 1

### T2.6: Plan completion integrity check (Fix 16)

- **Objective:** Replace SUMMARY.md existence check with content validation (Self-Check: PASSED, no test failures)
- **Complexity:** M
- **Input files:**
  - `atos-forge/bin/lib/core.cjs` (lines 256-262)
  - `atos-forge/bin/lib/phase.cjs` (lines 193-236)
- **Output files:** Both files — MODIFY completion check logic
- **Dependencies:** None
- **Success criteria:** Truncated SUMMARY.md without "Self-Check: PASSED" is not treated as complete.

### T2.7: Executor Rule 1 scope (Fix 20)

- **Objective:** Prohibit executor from silently modifying test files
- **Complexity:** S
- **Input files:** `agents/forge-executor.md` (lines 100-112)
- **Output files:** `agents/forge-executor.md` — ADD test modification prohibition
- **Dependencies:** None
- **Success criteria:** `grep "implementation code only" agents/forge-executor.md` matches.

### T2.8: Ledger write protection (Fix 23)

- **Objective:** Add file locking for concurrent agent ledger writes
- **Complexity:** M
- **Input files:** `forge-session/ledger.js` (line 148 writeRaw, line 184 appendToSection)
- **Output files:**
  - `forge-session/ledger.js` — MODIFY writeRaw and appendToSection with lock
  - `package.json` — ADD proper-lockfile dependency
- **Dependencies:** None
- **Success criteria:** `npm ls proper-lockfile` shows installed; writeRaw uses lockfile.lockSync.

### T2.9: Crash-recovery boot time (Fix 26)

- **Objective:** Add boot-time check to prevent PID reuse false positives after reboot
- **Complexity:** S
- **Input files:** `forge-session/crash-recovery.js` (lines 43-52)
- **Output files:** `forge-session/crash-recovery.js` — MODIFY readCrashLock
- **Dependencies:** None
- **Success criteria:** readCrashLock compares startedAt epoch against boot time before PID check.

### T2.10: Context-monitor fallback (Fix 27)

- **Objective:** Replace silent process.exit(0) with transcript-size estimation fallback
- **Complexity:** S
- **Input files:** `hooks/forge-context-monitor.js` (lines 51-53)
- **Output files:** `hooks/forge-context-monitor.js` — MODIFY stale handling
- **Dependencies:** None
- **Success criteria:** No `process.exit(0)` in the stale-metrics branch; transcript estimation code present.

### T2.11: Slim planner prompt (Fix 29)

- **Objective:** Extract worked examples and tables to reference cookbook, reduce prompt from ~11K to ~5K tokens
- **Complexity:** M
- **Input files:** `agents/forge-planner.md` (1277 lines)
- **Output files:**
  - `agents/forge-planner.md` — MODIFY (remove extracted sections, add @reference)
  - `atos-forge/references/planner-cookbook.md` — CREATE
- **Dependencies:** None
- **Success criteria:** `wc -w agents/forge-planner.md` drops by >= 50%.

### T2.12: Slim verifier and plan-checker prompts (Fix 30)

- **Objective:** Extract stub-detection patterns and worked examples to reference cookbook
- **Complexity:** M
- **Input files:**
  - `agents/forge-verifier.md` (755 lines)
  - `agents/forge-plan-checker.md` (748 lines)
- **Output files:**
  - `agents/forge-verifier.md` — MODIFY
  - `agents/forge-plan-checker.md` — MODIFY
  - `atos-forge/references/verifier-cookbook.md` — CREATE
- **Dependencies:** None
- **Success criteria:** Combined word count drops by >= 3000 words.

### T2.13: Researcher WebSearch budget (Fix 35)

- **Objective:** Add explicit WebSearch/WebFetch budget caps to researcher agents
- **Complexity:** S
- **Input files:**
  - `agents/forge-project-researcher.md`
  - `agents/forge-phase-researcher.md`
- **Output files:** Both files — ADD budget section
- **Dependencies:** None
- **Success criteria:** `grep "maximum 5 calls" agents/forge-project-researcher.md agents/forge-phase-researcher.md` matches both files.

---

## Phase 3: Pipeline Upgrades (All Parallel — depend on Phase 1)

> **Gate:** Phase 1 must pass. All 10 tasks run in parallel. All must pass before Phase 4.

### T3.1: Propagate parent contract into sub-plans (Fix 4)

- **Objective:** Attach parent_contract (truths, key_links, artifacts filtered by sub-plan files) to each sub-plan
- **Complexity:** M
- **Input files:** `forge-assess/splitter.js` (lines 705-743 buildSubPlan, ~749 formatSubPlanXML)
- **Output files:** `forge-assess/splitter.js` — MODIFY buildSubPlan, formatSubPlanXML, formatSubPlanJSON
- **Dependencies:** T1.1 (plan.frontmatter.must_haves must be populated by YAML parser)
- **Success criteria:** Sub-plan output contains parent_contract with filtered key_links and artifacts.

### T3.2: Inject plan contract into agent system prompt (Fix 5)

- **Objective:** Add "Plan Contract" section to agent system prompts with truths, key_links, artifacts, requirements
- **Complexity:** M
- **Input files:** `forge-agents/factory.js` (lines 431-684 composeSystemPrompt)
- **Output files:** `forge-agents/factory.js` — MODIFY composeSystemPrompt
- **Dependencies:** T1.1 (must_haves in frontmatter)
- **Success criteria:**
  ```bash
  node forge-agents/factory.js build test-fixtures/plan.md --root . 2>/dev/null | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.agentConfig.system_prompt.includes('Plan Contract'));
  "
  ```

### T3.3: Add KEY_LINKS verification layer (Fix 6)

- **Objective:** Add layerKeyLinks function as new verification layer in engine.js
- **Complexity:** L
- **Input files:**
  - `forge-verify/engine.js` (LAYER_NAMES array, verify() dispatcher)
  - `forge-config/config.js` (DEFAULTS.verification.layers)
- **Output files:** Both files — MODIFY
- **Dependencies:** T1.1 (key_links must be parseable from frontmatter)
- **Success criteria:** `node forge-verify/engine.js --root . --plan test.md --json` output includes KEY_LINKS layer.

### T3.4: Wave-to-wave findings bridge (Fix 9)

- **Objective:** Pass previousFindings from completed wave agents to next wave's factory builds
- **Complexity:** M
- **Input files:**
  - `forge-agents/factory.js` (~line 1200 buildAgentConfig)
  - `forge-containers/worktree-orchestrator.js`
  - `forge-containers/orchestrator.js`
- **Output files:** All three files — MODIFY
- **Dependencies:** None (rendering side at factory.js line 659-666 already works)
- **Success criteria:** buildAgentConfig accepts opts.previousFindings; orchestrators collect and pass findings.

### T3.5: Extend agent cache key (Fix 10)

- **Objective:** Add planning docs mtimes, factory version, and previousFindings to cache hash
- **Complexity:** S
- **Input files:** `forge-agents/cache.js` (lines 31-89 computeInputHash)
- **Output files:** `forge-agents/cache.js` — MODIFY computeInputHash
- **Dependencies:** None
- **Success criteria:** Changing REQUIREMENTS.md produces different hash; FACTORY_VERSION constant present.

### T3.6: Agent output JSON-Schema validation (Fix 14)

- **Objective:** Add formal schema validation to agent output with required fields check
- **Complexity:** M
- **Input files:** `forge-agents/agent-output-schema.js`
- **Output files:** `forge-agents/agent-output-schema.js` — MODIFY validateOutput
- **Dependencies:** None
- **Success criteria:** Malformed output (missing findings array) returns { valid: false, issues: [...] }.

### T3.7: Common vocabulary reference (Fix 28)

- **Objective:** Create shared vocabulary file and strip duplicate definitions from agent prompts
- **Complexity:** S
- **Input files:** Multiple agent .md files (scan for duplicate term definitions)
- **Output files:** `atos-forge/references/common-vocabulary.md` — CREATE
- **Dependencies:** None
- **Success criteria:** File exists with definitions for must_haves, key_links, truths, artifacts, requirements.

### T3.8: Cap ledger inclusion (Fix 32)

- **Objective:** Limit extractSessionContext to 30 entries per category to prevent token overflow
- **Complexity:** S
- **Input files:** `forge-agents/factory.js` (~line 1027 extractSessionContext)
- **Output files:** `forge-agents/factory.js` — MODIFY extractSessionContext
- **Dependencies:** None
- **Success criteria:** MAX_ENTRIES_PER_CATEGORY constant exists; .slice(-30) applied to each category.

### T3.9: Cache composed system prompt scaffold (Fix 33)

- **Objective:** Memoize system prompt scaffold (non-plan-specific parts) for reuse across agents
- **Complexity:** M
- **Input files:** `forge-agents/factory.js` (composeSystemPrompt)
- **Output files:** `forge-agents/factory.js` — MODIFY composeSystemPrompt
- **Dependencies:** None
- **Success criteria:** _promptScaffoldCache variable exists; second call with same archetype/session reuses scaffold.

### T3.10: Skip cache for revision and fix agents (Fix 12)

- **Objective:** Add --skip-cache to fix-agent and revision-planner factory builds in workflows
- **Complexity:** S
- **Input files:**
  - `atos-forge/workflows/execute-phase.md` (~line 513)
  - `atos-forge/workflows/plan-phase.md` (revision spawn)
- **Output files:** Both files — MODIFY
- **Dependencies:** None
- **Success criteria:** `grep "skip-cache\|skipCache" atos-forge/workflows/execute-phase.md atos-forge/workflows/plan-phase.md` matches in both.

---

## Phase 4: Integration & Complex Fixes (All Parallel — depend on Phases 2+3)

> **Gate:** Phases 2 and 3 must all pass. All 11 tasks run in parallel. All must pass before Phase 5.

### T4.1: Patch applier DAG ordering and conflict guard (Fix 11)

- **Objective:** Add pre-apply conflict detection and DAG-ordered patch application
- **Complexity:** L
- **Input files:**
  - `forge-containers/patch-collector.js`
  - `forge-containers/worktree-orchestrator.js`
- **Output files:** Both files — MODIFY
- **Dependencies:** T3.4 (DAG info from parallel-planner must flow through)
- **Success criteria:** Two patches touching same file triggers conflict error before apply.

### T4.2: Per-wave fast verifier (Fix 21)

- **Objective:** Wire verifyAfterWave with restricted layers (1-5 only) in execute-phase workflow
- **Complexity:** M
- **Input files:**
  - `forge-verify/loop.js`
  - `atos-forge/workflows/execute-phase.md` (step 5d)
- **Output files:** Both files — MODIFY
- **Dependencies:** T3.3 (KEY_LINKS layer must exist)
- **Success criteria:** verifyAfterWave function exists in loop.js; execute-phase.md references it.

### T4.3: Per-wave code reviewer agent (Fix 13)

- **Objective:** Create forge-code-reviewer.md agent and wire into execute-phase workflow
- **Complexity:** M
- **Input files:** `atos-forge/workflows/execute-phase.md` (step 5d)
- **Output files:**
  - `agents/forge-code-reviewer.md` — CREATE
  - `atos-forge/workflows/execute-phase.md` — MODIFY
- **Dependencies:** T3.3 (KEY_LINKS for review criteria)
- **Success criteria:** Agent file exists; execute-phase.md references forge-code-reviewer.

### T4.4: Proper subagent_type for all workflow spawns (Fix 34)

- **Objective:** Replace all general-purpose subagent_type with proper forge-X types in workflows
- **Complexity:** M
- **Input files:**
  - `atos-forge/workflows/plan-phase.md` (4 sites)
  - `atos-forge/workflows/new-project.md` (4 sites)
  - `atos-forge/workflows/quick.md` (1 site)
  - `atos-forge/workflows/diagnose-issues.md` (1 site)
- **Output files:** All four files — MODIFY
- **Dependencies:** T2.5 (debug template for diagnose-issues.md)
- **Success criteria:** `grep -r 'subagent_type="general-purpose"' atos-forge/workflows/` returns 0 matches.

### T4.5: Auto mode factory integration (Fix 17)

- **Objective:** Replace dispatcher.js buildPrompt with factory.buildAgentConfig; wire through worktree orchestrator
- **Complexity:** L
- **Input files:**
  - `forge-auto/dispatcher.js`
  - `forge-auto/auto.js`
- **Output files:** Both files — MODIFY
- **Dependencies:** T3.2, T3.3 (factory pipeline and KEY_LINKS must work)
- **Success criteria:** dispatcher.js imports and calls factory.buildAgentConfig; buildPrompt removed or deprecated.

### T4.6: Research integrity gate (Fix 18)

- **Objective:** Create forge-research-checker agent; add 2-iteration revision loop in plan-phase
- **Complexity:** M
- **Input files:** `atos-forge/workflows/plan-phase.md` (step 5)
- **Output files:**
  - `agents/forge-research-checker.md` — CREATE
  - `atos-forge/workflows/plan-phase.md` — MODIFY
- **Dependencies:** None specific
- **Success criteria:** Agent file exists; plan-phase.md references forge-research-checker.

### T4.7: Test-author agent before implementation (Fix 19)

- **Objective:** Create forge-test-author agent; insert Wave 0 in execute-phase for test-first workflow
- **Complexity:** L
- **Input files:** `atos-forge/workflows/execute-phase.md`
- **Output files:**
  - `agents/forge-test-author.md` — CREATE
  - `atos-forge/workflows/execute-phase.md` — MODIFY (add Wave 0)
- **Dependencies:** T1.1 (must_haves.truths must be parsed)
- **Success criteria:** Agent file exists; execute-phase.md mentions "Wave 0" or "test-author".

### T4.8: Truth-driven add-tests workflow (Fix 22)

- **Objective:** Replace TDD/E2E/Skip classifier with truth-to-test mapping in add-tests workflow
- **Complexity:** M
- **Input files:** `atos-forge/workflows/add-tests.md`
- **Output files:** `atos-forge/workflows/add-tests.md` — MODIFY
- **Dependencies:** T1.1 (must_haves.truths must be parsed)
- **Success criteria:** Workflow reads must_haves.truths and generates tests from them.

### T4.9: Codebase docs loading (Fix 24)

- **Objective:** Add codebaseDocsForPhaseType helper to load .planning/codebase/ docs into init commands
- **Complexity:** M
- **Input files:** `atos-forge/bin/lib/init.cjs`
- **Output files:** `atos-forge/bin/lib/init.cjs` — MODIFY
- **Dependencies:** None
- **Success criteria:** codebaseDocsForPhaseType function exists and is called from cmdInitPlanPhase.

### T4.10: Summary-then-load for init includes (Fix 31)

- **Objective:** Replace full file inlining with summary approach for large files in init commands
- **Complexity:** M
- **Input files:** `atos-forge/bin/lib/init.cjs`
- **Output files:** `atos-forge/bin/lib/init.cjs` — MODIFY
- **Dependencies:** None
- **Success criteria:** summarizeFile function exists; files >200 lines return summary, not full content.

### T4.11: Research provenance and refresh (Fix 25)

- **Objective:** Add source_dimension/confidence to enhancer output; create research-refresh workflow
- **Complexity:** M
- **Input files:** `agents/forge-requirement-enhancer.md`
- **Output files:**
  - `agents/forge-requirement-enhancer.md` — MODIFY
  - `atos-forge/workflows/research-refresh.md` — CREATE
- **Dependencies:** None
- **Success criteria:** Workflow file exists; enhancer mentions source_dimension in output schema.

---

## Phase 5: Testing & Final Validation (Sequential)

> **Gate:** ALL prior phases must pass. Tasks run sequentially.

### T5.1: Multi-runtime conversion tests (Fix 36)

- **Objective:** Create regression tests for agent prompt conversion across 3 runtimes
- **Complexity:** M
- **Input files:** All agent .md files in `agents/`
- **Output files:** `tests/install-conversions.test.cjs` — CREATE
- **Dependencies:** All prior phases
- **Success criteria:** `node --test tests/install-conversions.test.cjs` passes.

### T5.2: Requirements pipeline regression test

- **Objective:** Create end-to-end test: parsePlan → factory → verify round-trip
- **Complexity:** L
- **Input files:** All modified modules from prior phases
- **Output files:** `tests/requirements-pipeline.test.cjs` — CREATE
- **Dependencies:** All prior phases
- **Success criteria:** `node --test tests/requirements-pipeline.test.cjs` passes.

---

## Risk Assessment

### Phase 1 Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| YAML.parse returns different structure than regex | Medium | High | Preserve spread operator to maintain backward compat |
| Existing tests depend on regex behavior | Low | Medium | Run all tests after change |

### Phase 2 Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| T2.1 conflicts with T1.1 on assessor.js | Medium | Medium | T2.1 depends on Phase 1; edits different lines |
| proper-lockfile compatibility | Low | Low | Pure JS package, no native deps |
| Prompt reduction breaks agent behavior | Medium | Medium | Preserve all procedural content; only extract examples |

### Phase 3 Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| factory.js touched by T3.2, T3.4, T3.8, T3.9 | High | High | Each touches different function — no line overlap. Verify after each. |
| KEY_LINKS layer integration | Medium | Medium | Add after existing layers; don't renumber |

### Phase 4 Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| execute-phase.md touched by T4.2, T4.3, T4.7 | High | High | Each adds to different workflow steps. Merge carefully. |
| Auto mode rewrite scope | Medium | High | Replace buildPrompt only; keep state machine intact |

### Phase 5 Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tests fail due to incomplete prior fixes | Medium | High | Run all prior verification commands first |

---

## Verification Protocol

### Per-task verification
1. Execute the task's success criteria command(s)
2. On failure: diagnose → fix → re-run (max 3 iterations)
3. On success: mark task complete, proceed

### Per-phase verification
After all tasks in a phase complete:
1. Re-run ALL success criteria from all prior phases (regression check)
2. Run `node -e "require('./forge-assess/assessor.js')"` (module loads without error)
3. Run `node -e "require('./forge-agents/factory.js')"` (module loads without error)
4. Run `node -e "require('./forge-verify/engine.js')"` (module loads without error)
5. Any regression → identify offending task → fix → re-verify

### Final validation (after Phase 5)
1. All 37 task verification commands pass
2. Both Phase 5 test suites pass
3. `npm test` passes (if configured)
4. No require() errors across all modules
