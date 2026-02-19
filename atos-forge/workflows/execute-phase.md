<purpose>
Execute all plans in a phase using wave-based parallel execution. Orchestrator stays lean — delegates plan execution to subagents.
</purpose>

<core_principle>
Orchestrator coordinates, not executes. Each subagent loads the full execute-plan context. Orchestrator: discover plans → analyze deps → group waves → spawn agents → handle checkpoints → collect results.
</core_principle>

<required_reading>
Read STATE.md before any operation to load project context.
If `.forge/session/ledger.md` exists, read it to restore session context (decisions, warnings, preferences).
</required_reading>

<process>

<step name="initialize" priority="first">
Load all context in one call:

```bash
INIT=$(node ~/.claude/atos-forge/bin/forge-tools.cjs init execute-phase "${PHASE_ARG}")
```

Parse JSON for: `executor_model`, `verifier_model`, `commit_docs`, `parallelization`, `branching_strategy`, `branch_name`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `plans`, `incomplete_plans`, `plan_count`, `incomplete_count`, `state_exists`, `roadmap_exists`.

**If `phase_found` is false:** Error — phase directory not found.
**If `plan_count` is 0:** Error — no plans found in phase.
**If `state_exists` is false but `.planning/` exists:** Offer reconstruct or continue.

When `parallelization` is false, plans within a wave execute sequentially.
</step>

<step name="handle_branching">
Check `branching_strategy` from init:

**"none":** Skip, continue on current branch.

**"phase" or "milestone":** Use pre-computed `branch_name` from init:
```bash
git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
```

All subsequent commits go to this branch. User handles merging.
</step>

<step name="validate_phase">
From init JSON: `phase_dir`, `plan_count`, `incomplete_count`.

Report: "Found {plan_count} plans in {phase_dir} ({incomplete_count} incomplete)"
</step>

<step name="discover_and_group_plans">
Load plan inventory with wave grouping in one call:

```bash
PLAN_INDEX=$(node ~/.claude/atos-forge/bin/forge-tools.cjs phase-plan-index "${PHASE_NUMBER}")
```

Parse JSON for: `phase`, `plans[]` (each with `id`, `wave`, `autonomous`, `objective`, `files_modified`, `task_count`, `has_summary`), `waves` (map of wave number → plan IDs), `incomplete`, `has_checkpoints`.

**Filtering:** Skip plans where `has_summary: true`. If `--gaps-only`: also skip non-gap_closure plans. If all filtered: "No matching incomplete plans" → exit.

Report:
```
## Execution Plan

**Phase {X}: {Name}** — {total_plans} plans across {wave_count} waves

| Wave | Plans | What it builds |
|------|-------|----------------|
| 1 | 01-01, 01-02 | {from plan objectives, 3-8 words} |
| 2 | 01-03 | ... |
```
</step>

<step name="graph_impact_check">
**Pre-execution impact analysis (if code graph exists):**

```bash
GRAPH_STATUS=$(node ~/.claude/atos-forge/bin/forge-tools.cjs graph status 2>/dev/null || echo '{"graph_exists":false}')
GRAPH_EXISTS=$(echo "$GRAPH_STATUS" | jq -r '.graph_exists')
```

**If `GRAPH_EXISTS` is true:**

Run impact analysis on all files in the phase:
```bash
IMPACT=$(node ~/.claude/atos-forge/bin/forge-tools.cjs graph impact --phase "${PHASE_NUMBER}" 2>/dev/null || echo '{}')
RISK_LEVEL=$(echo "$IMPACT" | jq -r '.risk.level // "UNKNOWN"')
RISK_REASONS=$(echo "$IMPACT" | jq -r '.risk.reasons // [] | join("; ")')
CONSUMER_COUNT=$(echo "$IMPACT" | jq -r '.summary.consumerCount // 0')
BOUNDARY_COUNT=$(echo "$IMPACT" | jq -r '.summary.boundariesCrossed // 0')
```

Display impact summary:
```
◆ Code Graph Impact: Risk={RISK_LEVEL}, Consumers={CONSUMER_COUNT}, Boundaries={BOUNDARY_COUNT}
{if RISK_REASONS: "  Reasons: {RISK_REASONS}"}
```

**If `RISK_LEVEL` is "HIGH" or "CRITICAL":**

Use AskUserQuestion:
- header: "High risk"
- question: "Code graph shows {RISK_LEVEL} risk: {RISK_REASONS}. This phase affects {CONSUMER_COUNT} downstream consumers across {BOUNDARY_COUNT} module boundaries. Proceed with execution?"
- options:
  - "Proceed" — Execute despite high risk
  - "Review impact first" — Run `/forge:impact {PHASE_NUMBER}` for full analysis before deciding

If "Review impact first": Display `/forge:impact {PHASE_NUMBER}` and exit workflow.

**Ledger:** Log the risk assessment result:
```bash
TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
node "$TOOLS" ledger log-decision "Pre-execution risk: ${RISK_LEVEL} (consumers=${CONSUMER_COUNT}, boundaries=${BOUNDARY_COUNT})" --rationale "${RISK_REASONS}" 2>/dev/null
```

**If `GRAPH_EXISTS` is false:** Display note:
```
◇ No code graph — run /forge:init for pre-execution impact analysis
```
</step>

<step name="assess_and_split_plans">
**Assess each plan for context fit and split if needed.**

For each incomplete plan from `discover_and_group_plans`:

```bash
ASSESSOR="$HOME/.claude/atos-forge/forge-assess/assessor.js"
if [ -f "$ASSESSOR" ]; then
  ASSESSMENT=$(node "$ASSESSOR" "${PLAN_PATH}" --root "$(pwd)" 2>/dev/null)
fi
```

Parse each assessment for: `needs_split`, `strategy`, `metrics.overflow_ratio`, `metrics.total_estimated`, `metrics.context_limit`.

**If `needs_split` is true for any plan:**

Run the splitter:
```bash
SPLITTER="$HOME/.claude/atos-forge/forge-assess/splitter.js"
SPLIT_RESULT=$(node "$SPLITTER" "${PLAN_PATH}" --root "$(pwd)" --format json 2>/dev/null)
```

Parse split result for: `sub_plans[]` (each with `subtask`, `name`, `files`, `depends_on`, `context_budget`, `graph_context`, `session_context`, `action`, `verify`, `done`, `meta`).

Replace the original plan in the execution DAG with its sub-plans. Sub-plans inherit the parent's wave but add internal ordering via `depends_on`.

**Rebuild wave grouping:**

After all assessments, rebuild the execution DAG:
- Plans that fit → keep as-is in their original wave
- Split plans → sub-plans ordered by `depends_on`, interface-producing sub-plans in earlier position
- Sub-plans marked `parallelizable: true` → same wave position
- Sub-plans with dependencies → later wave position

**Display execution summary:**

```
╔═══════════════════════════════════════════════════════════╗
║              EXECUTION PLAN — Phase {X}                   ║
╠═══════════════════════════════════════════════════════════╣
{For each plan:}
║  Plan {N}: {objective}                                    ║
║    Assessment: OK ({utilization}% context utilization)     ║
{OR if split:}
║  Plan {N}: {objective}                                    ║
║    Assessment: SPLIT ({overflow_ratio}% — exceeds context) ║
║    → Sub-plan {N}a: {name} ({budget_pct}%)                ║
║    → Sub-plan {N}b: {name} ({budget_pct}%)                ║
║    → Sub-plan {N}c: {name} ({budget_pct}%)                ║
╠═══════════════════════════════════════════════════════════╣
║  Execution: Wave 1: [{ids}] → Wave 2: [{ids}] → ...      ║
╚═══════════════════════════════════════════════════════════╝
```

Calculate `utilization` as: `(metrics.total_estimated / metrics.context_limit * 100)`.
Calculate `budget_pct` for sub-plans as: estimated file tokens / context_budget * 100.

**Ledger:** Log assessment results:
```bash
TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
# For each assessed plan:
node "$TOOLS" ledger log-decision "Plan ${PLAN_ID} assessed: ${STATUS} (${UTILIZATION}% context)" --rationale "${REASON}" 2>/dev/null
# For each split:
node "$TOOLS" ledger log-decision "Plan ${PLAN_ID} split into ${SUBTASK_COUNT} sub-plans (${STRATEGY})" --rationale "${SPLIT_REASON}" 2>/dev/null
```

**Interactive mode (not YOLO):**

Check config mode:
```bash
MODE=$(node ~/.claude/atos-forge/bin/forge-tools.cjs config-get mode 2>/dev/null || echo "interactive")
```

If `MODE` is "interactive": Use AskUserQuestion:
- header: "Execute"
- question: "Proceed with this execution plan?"
- options:
  - "Execute" — Run all waves as planned
  - "Review splits" — Show detailed sub-plan breakdown before proceeding
  - "Abort" — Cancel execution

If "Review splits": Display each sub-plan's full XML (from splitter output), then re-ask execute/abort.
If "Abort": Exit workflow.

**If YOLO mode or "Execute" selected:** Continue to `execute_waves`.

**If assessor not available (file doesn't exist):** Skip assessment, continue with original plans. Display:
```
◇ No assessor available — executing plans without context assessment
```
</step>

<step name="execute_waves">
Execute each wave in sequence. Within a wave: parallel if `PARALLELIZATION=true`, sequential if `false`.

**For each wave:**

1. **Describe what's being built (BEFORE spawning):**

   Read each plan's `<objective>`. Extract what's being built and why.

   ```
   ---
   ## Wave {N}

   **{Plan ID}: {Plan Name}**
   {2-3 sentences: what this builds, technical approach, why it matters}

   Spawning {count} agent(s)...
   ---
   ```

   - Bad: "Executing terrain generation plan"
   - Good: "Procedural terrain generator using Perlin noise — creates height maps, biome zones, and collision meshes. Required before vehicle physics can interact with ground."

2. **Spawn executor agents:**

   Pass paths only — executors read files themselves with their fresh 200k context.
   This keeps orchestrator context lean (~10-15%).

   ```
   Task(
     subagent_type="forge-executor",
     model="{executor_model}",
     prompt="
       <objective>
       Execute plan {plan_number} of phase {phase_number}-{phase_name}.
       Commit each task atomically. Create SUMMARY.md. Update STATE.md and ROADMAP.md.
       </objective>

       <execution_context>
       @~/.claude/atos-forge/workflows/execute-plan.md
       @~/.claude/atos-forge/templates/summary.md
       @~/.claude/atos-forge/references/checkpoints.md
       @~/.claude/atos-forge/references/tdd.md
       </execution_context>

       <files_to_read>
       Read these files at execution start using the Read tool:
       - Plan: {phase_dir}/{plan_file}
       - State: .planning/STATE.md
       - Config: .planning/config.json (if exists)
       </files_to_read>

       <success_criteria>
       - [ ] All tasks executed
       - [ ] Each task committed individually
       - [ ] SUMMARY.md created in plan directory
       - [ ] STATE.md updated with position and decisions
       - [ ] ROADMAP.md updated with plan progress (via `roadmap update-plan-progress`)
       </success_criteria>
     "
   )
   ```

3. **Wait for all agents in wave to complete.**

4. **Report completion — spot-check claims first:**

   For each SUMMARY.md:
   - Verify first 2 files from `key-files.created` exist on disk
   - Check `git log --oneline --all --grep="{phase}-{plan}"` returns ≥1 commit
   - Check for `## Self-Check: FAILED` marker

   If ANY spot-check fails: report which plan failed, route to failure handler — ask "Retry plan?" or "Continue with remaining waves?"

   If pass:
   ```
   ---
   ## Wave {N} Complete

   **{Plan ID}: {Plan Name}**
   {What was built — from SUMMARY.md}
   {Notable deviations, if any}

   {If more waves: what this enables for next wave}
   ---
   ```

   - Bad: "Wave 2 complete. Proceeding to Wave 3."
   - Good: "Terrain system complete — 3 biome types, height-based texturing, physics collision meshes. Vehicle physics (Wave 3) can now reference ground surfaces."

   **Ledger:** After each wave completes, log progress:
   ```bash
   TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
   node "$TOOLS" ledger update-state "{\"current_wave\":\"${WAVE_NUM} of ${TOTAL_WAVES}\",\"agents_complete\":${COMPLETED},\"agents_running\":0,\"agents_queued\":${REMAINING}}" 2>/dev/null
   # For each completed plan in the wave:
   node "$TOOLS" ledger log-decision "Wave ${WAVE_NUM} complete: ${PLAN_IDS}" --rationale "${SUMMARY_ONELINER}" 2>/dev/null
   ```

   **Ledger:** If any agent reports learnings or warnings from SUMMARY.md, log them:
   ```bash
   # From SUMMARY.md issues section:
   node "$TOOLS" ledger log-warning "${ISSUE_TEXT}" --severity medium --source "forge-executor-${PLAN_ID}" 2>/dev/null
   # From SUMMARY.md discoveries:
   node "$TOOLS" ledger log-discovery "${DISCOVERY_TEXT}" --source "forge-executor-${PLAN_ID}" 2>/dev/null
   ```

   **Sub-plan handling:** When executing a sub-plan from the splitter (has `parent_plan` and `subtask` fields):
   - Pass the sub-plan's `<graph_context>` instructions to the executor so it loads relevant graph data
   - Pass the sub-plan's `<session_context>` instructions so it loads relevant ledger entries
   - Use the sub-plan's `<files>` as the scope (not the parent plan's full file list)
   - Use the sub-plan's `<action>`, `<verify>`, `<done>` instead of the parent plan's tasks
   - After sub-plan completes: run its `<verify>` checks before proceeding to dependent sub-plans

   Modify the executor spawn for sub-plans:
   ```
   Task(
     subagent_type="forge-executor",
     model="{executor_model}",
     prompt="
       <objective>
       Execute sub-plan {subtask} of plan {parent_plan} in phase {phase_number}-{phase_name}.
       This is an auto-split task — only modify files in scope.
       Commit each change atomically. Create SUMMARY.md. Update STATE.md.
       </objective>

       <execution_context>
       @~/.claude/atos-forge/workflows/execute-plan.md
       @~/.claude/atos-forge/templates/summary.md
       @~/.claude/atos-forge/references/checkpoints.md
       @~/.claude/atos-forge/references/tdd.md
       </execution_context>

       <sub_plan>
       {Full sub-plan XML from splitter — includes files, action, verify, done}
       </sub_plan>

       <context_loading>
       Graph context: {sub_plan.graph_context instructions}
       Session context: {sub_plan.session_context instructions}
       </context_loading>

       <files_to_read>
       Read these files at execution start:
       - Parent plan: {phase_dir}/{parent_plan_file} (for overall context)
       - State: .planning/STATE.md
       - Config: .planning/config.json (if exists)
       - Ledger: .forge/session/ledger.md (if exists — load per session_context instructions)
       </files_to_read>

       <success_criteria>
       - [ ] All actions from sub-plan executed
       - [ ] Each change committed individually
       - [ ] Verification checks pass: {sub_plan.verify}
       - [ ] SUMMARY.md created
       - [ ] STATE.md updated
       </success_criteria>
     "
   )
   ```

5. **After-wave graph update and diff:**

   After each wave completes (before proceeding to next wave), update the graph incrementally and show structural changes:

   ```bash
   if [ "$GRAPH_EXISTS" = "true" ]; then
     UPDATER_PATH="$HOME/.claude/atos-forge/forge-graph/updater.js"
     TOOLS_PATH="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"

     # Update graph with changes from this wave
     if [ -f "$UPDATER_PATH" ]; then
       node "$UPDATER_PATH" "$(pwd)" > /dev/null 2>&1
     fi

     # Save snapshot after this wave
     if [ -f "$TOOLS_PATH" ]; then
       node "$TOOLS_PATH" graph snapshot save > /dev/null 2>&1
     fi

     # Show graph diff (structural changes from this wave)
     DIFF_OUTPUT=$(node "$TOOLS_PATH" graph snapshot-diff 2>/dev/null || echo "")
     if [ -n "$DIFF_OUTPUT" ]; then
       echo "◆ Graph changes after Wave ${WAVE_NUM}:"
       echo "$DIFF_OUTPUT"
     fi
   fi
   ```

   **Ledger:** Log wave graph state:
   ```bash
   TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
   node "$TOOLS" ledger log-decision "Wave ${WAVE_NUM} graph updated — snapshot saved" --rationale "Post-wave incremental update" 2>/dev/null
   ```

6. **Re-assess remaining plans (if splits occurred):**

   If any plans were split in `assess_and_split_plans`, re-assess remaining unexecuted plans after each wave. Context requirements may have changed due to:
   - New files created by this wave
   - Interface changes affecting downstream consumers
   - Module boundary shifts

   ```bash
   ASSESSOR="$HOME/.claude/atos-forge/forge-assess/assessor.js"
   if [ -f "$ASSESSOR" ] && [ "$HAS_SPLITS" = "true" ]; then
     for REMAINING_PLAN in "${REMAINING_PLANS[@]}"; do
       REASSESS=$(node "$ASSESSOR" "$REMAINING_PLAN" --root "$(pwd)" 2>/dev/null)
       # If a previously-OK plan now overflows (due to new files), warn
       # If a split plan's remaining sub-plans now fit in fewer chunks, note
     done
   fi
   ```

   If re-assessment reveals new overflows, log a warning but do NOT re-split mid-execution — continue with the original plan. The warning alerts the user to potential issues.

   ```bash
   node "$TOOLS" ledger log-warning "Re-assessment: plan ${PLAN_ID} now at ${NEW_RATIO}% context (was ${OLD_RATIO}%)" --severity medium --source "execute-phase" 2>/dev/null
   ```

7. **Handle failures:**

   **Known Claude Code bug (classifyHandoffIfNeeded):** If an agent reports "failed" with error containing `classifyHandoffIfNeeded is not defined`, this is a Claude Code runtime bug — not a A-Forge or agent issue. The error fires in the completion handler AFTER all tool calls finish. In this case: run the same spot-checks as step 4 (SUMMARY.md exists, git commits present, no Self-Check: FAILED). If spot-checks PASS → treat as **successful**. If spot-checks FAIL → treat as real failure below.

   For real failures: report which plan failed → ask "Continue?" or "Stop?" → if continue, dependent plans may also fail. If stop, partial completion report.

   **Ledger:** Log failures:
   ```bash
   TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
   node "$TOOLS" ledger log-error "${FAILURE_DESCRIPTION}" --fix "${FIX_IF_ANY}" 2>/dev/null
   ```

8. **Execute checkpoint plans between waves** — see `<checkpoint_handling>`.

9. **Proceed to next wave.**
</step>

<step name="checkpoint_handling">
Plans with `autonomous: false` require user interaction.

**Auto-mode checkpoint handling:**

Read auto-advance config:
```bash
AUTO_CFG=$(node ~/.claude/atos-forge/bin/forge-tools.cjs config-get workflow.auto_advance 2>/dev/null || echo "false")
```

When executor returns a checkpoint AND `AUTO_CFG` is `"true"`:
- **human-verify** → Auto-spawn continuation agent with `{user_response}` = `"approved"`. Log `⚡ Auto-approved checkpoint`.
- **decision** → Auto-spawn continuation agent with `{user_response}` = first option from checkpoint details. Log `⚡ Auto-selected: [option]`.
- **human-action** → Present to user (existing behavior below). Auth gates cannot be automated.

**Standard flow (not auto-mode, or human-action type):**

1. Spawn agent for checkpoint plan
2. Agent runs until checkpoint task or auth gate → returns structured state
3. Agent return includes: completed tasks table, current task + blocker, checkpoint type/details, what's awaited
4. **Present to user:**
   ```
   ## Checkpoint: [Type]

   **Plan:** 03-03 Dashboard Layout
   **Progress:** 2/3 tasks complete

   [Checkpoint Details from agent return]
   [Awaiting section from agent return]
   ```
5. User responds: "approved"/"done" | issue description | decision selection
6. **Spawn continuation agent (NOT resume)** using continuation-prompt.md template:
   - `{completed_tasks_table}`: From checkpoint return
   - `{resume_task_number}` + `{resume_task_name}`: Current task
   - `{user_response}`: What user provided
   - `{resume_instructions}`: Based on checkpoint type
7. Continuation agent verifies previous commits, continues from resume point
8. Repeat until plan completes or user stops

**Why fresh agent, not resume:** Resume relies on internal serialization that breaks with parallel tool calls. Fresh agents with explicit state are more reliable.

**Checkpoints in parallel waves:** Agent pauses and returns while other parallel agents may complete. Present checkpoint, spawn continuation, wait for all before next wave.

**Ledger:** Log checkpoints and user responses:
```bash
TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
# When checkpoint is hit:
node "$TOOLS" ledger log-decision "Checkpoint: ${CHECKPOINT_TYPE} in plan ${PLAN_ID}" --rationale "${CHECKPOINT_DETAILS}" 2>/dev/null
# When user responds:
node "$TOOLS" ledger log-decision "User response to checkpoint: ${USER_RESPONSE}" 2>/dev/null
```
</step>

<step name="update_graph">
**Final graph update + full diff (if code graph exists):**

After all waves complete (before verification), do a final graph refresh. Per-wave updates already happened in `execute_waves` step 5, but this ensures completeness.

```bash
if [ "$GRAPH_EXISTS" = "true" ]; then
  UPDATER_PATH="$HOME/.claude/atos-forge/forge-graph/updater.js"
  TOOLS_PATH="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
  if [ -f "$UPDATER_PATH" ]; then
    node "$UPDATER_PATH" "$(pwd)" > /dev/null 2>&1
    echo "◆ Code graph updated (final)"
  fi
  if [ -f "$TOOLS_PATH" ]; then
    node "$TOOLS_PATH" graph snapshot save > /dev/null 2>&1
    echo "◆ Final graph snapshot saved"
  fi
fi
```

**Show full graph diff (entire phase vs pre-execution baseline):**

Compare the final snapshot against the pre-execution snapshot (saved before wave 1):

```bash
if [ "$GRAPH_EXISTS" = "true" ]; then
  TOOLS_PATH="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
  FULL_DIFF=$(node "$TOOLS_PATH" graph snapshot-diff 2>/dev/null || echo "")
  if [ -n "$FULL_DIFF" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " Graph Diff — Phase ${PHASE_NUMBER} (all waves)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$FULL_DIFF"
    echo ""
  fi
fi
```

**Ledger:** Log final graph state:
```bash
TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
node "$TOOLS" ledger update-state "{\"status\":\"graph updated, proceeding to verification\"}" 2>/dev/null
node "$TOOLS" ledger log-decision "Phase ${PHASE_NUMBER} graph final update complete" --rationale "Full diff captured in snapshot" 2>/dev/null
```
</step>

<step name="aggregate_results">
After all waves:

```markdown
## Phase {X}: {Name} Execution Complete

**Waves:** {N} | **Plans:** {M}/{total} complete

| Wave | Plans | Status |
|------|-------|--------|
| 1 | plan-01, plan-02 | ✓ Complete |
| CP | plan-03 | ✓ Verified |
| 2 | plan-04 | ✓ Complete |

### Plan Details
1. **03-01**: [one-liner from SUMMARY.md]
2. **03-02**: [one-liner from SUMMARY.md]

### Issues Encountered
[Aggregate from SUMMARYs, or "None"]
```
</step>

<step name="close_parent_artifacts">
**For decimal/polish phases only (X.Y pattern):** Close the feedback loop by resolving parent UAT and debug artifacts.

**Skip if** phase number has no decimal (e.g., `3`, `04`) — only applies to gap-closure phases like `4.1`, `03.1`.

**1. Detect decimal phase and derive parent:**
```bash
# Check if phase_number contains a decimal
if [[ "$PHASE_NUMBER" == *.* ]]; then
  PARENT_PHASE="${PHASE_NUMBER%%.*}"
fi
```

**2. Find parent UAT file:**
```bash
PARENT_INFO=$(node ~/.claude/atos-forge/bin/forge-tools.cjs find-phase "${PARENT_PHASE}" --raw)
# Extract directory from PARENT_INFO JSON, then find UAT file in that directory
```

**If no parent UAT found:** Skip this step (gap-closure may have been triggered by VERIFICATION.md instead).

**3. Update UAT gap statuses:**

Read the parent UAT file's `## Gaps` section. For each gap entry with `status: failed`:
- Update to `status: resolved`

**4. Update UAT frontmatter:**

If all gaps now have `status: resolved`:
- Update frontmatter `status: diagnosed` → `status: resolved`
- Update frontmatter `updated:` timestamp

**5. Resolve referenced debug sessions:**

For each gap that has a `debug_session:` field:
- Read the debug session file
- Update frontmatter `status:` → `resolved`
- Update frontmatter `updated:` timestamp
- Move to resolved directory:
```bash
mkdir -p .planning/debug/resolved
mv .planning/debug/{slug}.md .planning/debug/resolved/
```

**6. Commit updated artifacts:**
```bash
node ~/.claude/atos-forge/bin/forge-tools.cjs commit "docs(phase-${PARENT_PHASE}): resolve UAT gaps and debug sessions after ${PHASE_NUMBER} gap closure" --files .planning/phases/*${PARENT_PHASE}*/*-UAT.md .planning/debug/resolved/*.md
```
</step>

<step name="verify_phase_goal">
Verify phase achieved its GOAL, not just completed tasks.

```bash
PHASE_REQ_IDS=$(node ~/.claude/atos-forge/bin/forge-tools.cjs roadmap get-phase "${PHASE_NUMBER}" | jq -r '.section' | grep -i "Requirements:" | sed 's/.*Requirements:\*\*\s*//' | sed 's/[\[\]]//g')
```

```
Task(
  prompt="Verify phase {phase_number} goal achievement.
Phase directory: {phase_dir}
Phase goal: {goal from ROADMAP.md}
Phase requirement IDs: {phase_req_ids}
Check must_haves against actual codebase.
Cross-reference requirement IDs from PLAN frontmatter against REQUIREMENTS.md — every ID MUST be accounted for.
Create VERIFICATION.md.",
  subagent_type="forge-verifier",
  model="{verifier_model}"
)
```

Read status:
```bash
grep "^status:" "$PHASE_DIR"/*-VERIFICATION.md | cut -d: -f2 | tr -d ' '
```

| Status | Action |
|--------|--------|
| `passed` | → update_roadmap |
| `human_needed` | Present items for human testing, get approval or feedback |
| `gaps_found` | Present gap summary, offer `/forge:plan-phase {phase} --gaps` |

**If human_needed:**
```
## ✓ Phase {X}: {Name} — Human Verification Required

All automated checks passed. {N} items need human testing:

{From VERIFICATION.md human_verification section}

"approved" → continue | Report issues → gap closure
```

**If gaps_found:**
```
## ⚠ Phase {X}: {Name} — Gaps Found

**Score:** {N}/{M} must-haves verified
**Report:** {phase_dir}/{phase_num}-VERIFICATION.md

### What's Missing
{Gap summaries from VERIFICATION.md}

---
## ▶ Next Up

`/forge:plan-phase {X} --gaps`

<sub>`/clear` first → fresh context window</sub>

Also: `cat {phase_dir}/{phase_num}-VERIFICATION.md` — full report
Also: `/forge:verify-work {X}` — manual testing first
```

Gap closure cycle: `/forge:plan-phase {X} --gaps` reads VERIFICATION.md → creates gap plans with `gap_closure: true` → user runs `/forge:execute-phase {X} --gaps-only` → verifier re-runs.

**Ledger:** Log verification outcome:
```bash
TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
# On passed:
node "$TOOLS" ledger log-decision "Phase ${PHASE_NUMBER} verification passed" --rationale "All must-haves verified" 2>/dev/null
# On gaps_found:
node "$TOOLS" ledger log-warning "Phase ${PHASE_NUMBER} verification found gaps — ${GAP_COUNT} must-haves missing" --severity high 2>/dev/null
# On human_needed:
node "$TOOLS" ledger log-decision "Phase ${PHASE_NUMBER} automated checks passed, awaiting human verification" 2>/dev/null
```
</step>

<step name="update_roadmap">
**Mark phase complete and update all tracking files:**

```bash
COMPLETION=$(node ~/.claude/atos-forge/bin/forge-tools.cjs phase complete "${PHASE_NUMBER}")
```

The CLI handles:
- Marking phase checkbox `[x]` with completion date
- Updating Progress table (Status → Complete, date)
- Updating plan count to final
- Advancing STATE.md to next phase
- Updating REQUIREMENTS.md traceability

Extract from result: `next_phase`, `next_phase_name`, `is_last_phase`.

```bash
node ~/.claude/atos-forge/bin/forge-tools.cjs commit "docs(phase-{X}): complete phase execution" --files .planning/ROADMAP.md .planning/STATE.md .planning/REQUIREMENTS.md .planning/phases/{phase_dir}/*-VERIFICATION.md
```

**Ledger:** Archive ledger on phase completion:
```bash
TOOLS="$HOME/.claude/atos-forge/atos-forge/bin/forge-tools.cjs"
node "$TOOLS" ledger archive "phase-${PHASE_NUMBER}" 2>/dev/null
node "$TOOLS" ledger update-state "{\"active_phase\":\"${NEXT_PHASE}\",\"status\":\"phase ${PHASE_NUMBER} complete\"}" 2>/dev/null
```
</step>

<step name="offer_next">

**Exception:** If `gaps_found`, the `verify_phase_goal` step already presents the gap-closure path (`/forge:plan-phase {X} --gaps`). No additional routing needed — skip auto-advance.

**Auto-advance detection:**

1. Parse `--auto` flag from $ARGUMENTS
2. Read `workflow.auto_advance` from config:
   ```bash
   AUTO_CFG=$(node ~/.claude/atos-forge/bin/forge-tools.cjs config-get workflow.auto_advance 2>/dev/null || echo "false")
   ```

**If `--auto` flag present OR `AUTO_CFG` is true (AND verification passed with no gaps):**

```
╔══════════════════════════════════════════╗
║  AUTO-ADVANCING → TRANSITION             ║
║  Phase {X} verified, continuing chain    ║
╚══════════════════════════════════════════╝
```

Execute the transition workflow inline (do NOT use Task — orchestrator context is ~10-15%, transition needs phase completion data already in context):

Read and follow `~/.claude/atos-forge/workflows/transition.md`, passing through the `--auto` flag so it propagates to the next phase invocation.

**If neither `--auto` nor `AUTO_CFG` is true:**

The workflow ends. The user runs `/forge:progress` or invokes the transition workflow manually.
</step>

</process>

<context_efficiency>
Orchestrator: ~10-15% context. Subagents: fresh 200k each. No polling (Task blocks). No context bleed.
</context_efficiency>

<failure_handling>
- **classifyHandoffIfNeeded false failure:** Agent reports "failed" but error is `classifyHandoffIfNeeded is not defined` → Claude Code bug, not A-Forge. Spot-check (SUMMARY exists, commits present) → if pass, treat as success
- **Agent fails mid-plan:** Missing SUMMARY.md → report, ask user how to proceed
- **Dependency chain breaks:** Wave 1 fails → Wave 2 dependents likely fail → user chooses attempt or skip
- **All agents in wave fail:** Systemic issue → stop, report for investigation
- **Checkpoint unresolvable:** "Skip this plan?" or "Abort phase execution?" → record partial progress in STATE.md
</failure_handling>

<resumption>
Re-run `/forge:execute-phase {phase}` → discover_plans finds completed SUMMARYs → skips them → resumes from first incomplete plan → continues wave execution.

STATE.md tracks: last completed plan, current wave, pending checkpoints.
</resumption>
