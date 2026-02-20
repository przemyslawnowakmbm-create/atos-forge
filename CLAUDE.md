# Atos Forge — Agent Instructions

## Code Graph
Before modifying any file, query the code graph for context:
  node forge-graph/query.js context-for-task <file1> <file2> ...

Before cross-module changes, check impact:
  node forge-graph/query.js impact <file>

After changes, verify no new circular dependencies:
  node forge-graph/query.js cycles

Available graph commands:
  node forge-graph/query.js overview          — Codebase summary
  node forge-graph/query.js show <file>       — File dependencies
  node forge-graph/query.js impact <file>     — Blast radius
  node forge-graph/query.js hotspots          — High-churn files
  node forge-graph/query.js cycles            — Circular deps
  node forge-graph/query.js capabilities <m>  — Module capabilities

## Session Continuity
If .forge/session/ledger.md exists, ALWAYS read it at the start of your first response in a new context or after compaction. It contains:
- Current execution state (phase, wave, what's done)
- Decisions made and rationale (don't re-ask these questions)
- Warnings from agents (load into context for downstream work)
- User preferences for this session (respect these)
- Rejected approaches (don't retry these)

Trust the ledger over summarized conversation history when they conflict.

## Task Assessment & Splitting
When a plan overflows context, use the assessor + splitter pipeline:
  node forge-assess/assessor.js <plan-file> --root .    — Detect overflow, recommend strategy
  node forge-assess/splitter.js <plan-file> --root .    — Split into context-fitting sub-plans
  node forge-assess/splitter.js --test --root .         — Run pipeline self-test

Strategies: module (by module boundaries), concern (schema→impl→test→config), file (by symbols).
Cascading fallback: if a group still exceeds budget, it subdivides further (concern→file→symbol).
Each sub-plan includes graph_context and session_context loading instructions.

Configuration in .forge/config.json or .planning/config.json (execution section):
  context_budget (default 200000), assessment_threshold (default 0.80),
  safety_margin (default 0.20), auto_split, max_fix_loops, overhead_per_subtask.

## Execution Pipeline
The execute-phase workflow (atos-forge/workflows/execute-phase.md) runs the full pipeline:

1. **Load plans** — discover incomplete plans, filter by wave/gaps
2. **Assess & split** — assessor checks context fit, splitter breaks oversized plans
3. **Create agents** — factory builds specialized configs (archetype, prompt, context, verification)
4. **Plan parallel** — planner produces resource-aware execution waves (DAG + bin-packing)
5. **Execute waves** — per wave:
   a. Launch containers (or Task subagents in worktree fallback)
   b. Collect patches → apply via git apply --3way
   c. Quick verify (tsc, lint) → revert + fix-agent if failed (up to max_fix_loops)
   d. Update graph incrementally, save snapshot
   e. Write agent learnings to ledger (logWarning, logDiscovery, logWaveComplete)
   f. Re-build remaining agents with updated ledger (knowledge propagation)
6. **Full verification** — TypeScript, tests, lint, build, phase goal check
7. **Commit** with agent metadata: "feat(module): desc [forge:archetype]"
8. **Cleanup** — containers, worktrees, temp files, final graph update
9. **Log completion** — ledger update, archive on phase complete

Knowledge propagation: Wave N warnings → ledger → Wave N+1 session_context → agents avoid pitfalls.
Execution modes: container (Docker), worktree (no Docker fallback), weak machine (sequential).
16 workflow steps, 15 modules consumed, 9 structural sections.

## Ephemeral Containers
Containerized agent execution for isolated, parallel sub-plan work:
  node forge-containers/orchestrator.js status  — Docker + resource status
  node forge-containers/orchestrator.js build <template>  — Build image (node|python|full)
  node forge-containers/orchestrator.js cleanup — Remove stopped containers

Lifecycle: acquire slot → git worktree → build spec → run container → collect patches → log learnings → cleanup.
Resource limits in .forge/config.json (containers section): max_concurrent, max_memory_per_container, timeout_seconds.
Auto-detection: max_concurrent = min(floor((cores-2)/cpu), floor((ram*0.7)/mem)), hard cap 8.
Patches collected from /output/patches/, applied via git apply --3way.
Agent warnings/discoveries written to session ledger on collection.

Container entrypoints (baked into Docker images):
  agent-entrypoint.js — Full agent: reads agent.json, copies repo, applies previous patches,
    builds system prompt with session context, invokes `claude --print`, captures git diff as patch.
  agent-verifier.js — Lightweight: applies patches, runs verification steps (tsc, tests, lint),
    reports pass/fail. Auto-detects checks or uses explicit verification_steps from config.

## Worktree Orchestrator (Docker-free fallback)
Drop-in replacement when Docker is unavailable:
  node forge-containers/worktree-orchestrator.js status  [--root .]  — Claude CLI + resource status
  node forge-containers/worktree-orchestrator.js cleanup [--root .]  — Remove orphan worktrees
  node forge-containers/worktree-orchestrator.js detect  [--root .]  — Auto-detect execution mode

Same interface as Docker orchestrator: launch(), launchAll(), cleanup().
Lifecycle: acquire slot → git worktree → write agent config + graph DB + ledger → Claude Code subprocess
  (`claude --print --dangerously-skip-permissions`) → git diff as patch → apply to main repo → log learnings.
Parallelism: Promise pool via ResourceManager semaphore (same concurrency limits).
Auto-detection: `autoDetect(cwd)` returns { mode: 'container'|'worktree'|'none', orchestrator, reason }.

## Dynamic Agent Factory
Builds specialized agent configurations from sub-plans:
  node forge-agents/factory.js analyze <plan-file> --root .  — Show archetype, risk, context, verification
  node forge-agents/factory.js build <plan-file> --root .    — Output full agent config as JSON
  node forge-agents/factory.js build-all <dir> --root .      — Build configs for all .md plans in directory

7-step pipeline:
1. Analyze task — graph context (getContextForTask), capabilities, risk, ledger state
2. Determine archetype — specialist (single module + strong cap), integrator (3+ modules),
   careful (high/critical risk), general (fallback)
3. Compose system prompt — base executor + archetype behavior + capability agent_context + session context
4. Compose context package — always_load (plan + task files), task_specific (deps, consumers, tests),
   reference (interfaces). Token budget: 70% of context window.
5. Define verification — plan verify fields + capability-mapped checks (typescript, npm_test, etc.)
6. Define container spec — image auto-selection (node/python/full), resource config
7. Extract session context — decisions, warnings, preferences, rejected approaches from ledger

Programmatic: require('forge-agents/factory').buildAgentConfig(planPath, cwd, opts)
Returns: { agentConfig, containerParams, analysis }

## Parallel Execution Planner
Schedules agent execution in resource-aware waves:
  node forge-agents/parallel-planner.js plan <dir> --root .       — Plan from .md plans directory
  node forge-agents/parallel-planner.js dry-run <dir> --root .    — Plan without ledger write
  node forge-agents/parallel-planner.js plan-configs <json> --root . — Plan from pre-built JSON

Algorithm:
1. Build dependency DAG from agentConfig.plan_meta.frontmatter.depends_on
2. Topological sort (Kahn's) → independent groups (waves)
3. Per wave, bin-pack respecting: max_concurrent, max_total_memory, max_total_cpu
4. If wave exceeds limits → split into sub-waves
5. Output ordered waves with resource allocation + time estimates

Detects cycles. Logs plan to session ledger (waves_planned, total_agents, estimated_duration).
Archetype time estimates: specialist 2-5min, integrator 4-8min, careful 5-10min, general 3-6min.

Programmatic: require('forge-agents/parallel-planner').planExecution(factoryResults, cwd, opts)
Returns: { waves[], summary, resources, dependencies }

## 6-Layer Verification Engine
Graph-aware, fail-fast verification pipeline:
  node forge-verify/engine.js --root . [--files f1,f2] [--plan plan.md] [--layer 1-6] [--json]

Layers (fail-fast order):
1. STRUCTURAL (<5s) — syntax errors, stray console.log/debugger, merge conflict markers, bracket balance
2. TYPE/COMPILE (10-30s) — tsc --noEmit, mypy, go build (auto-detected from file extensions + graph capabilities)
3. INTERFACE CONTRACTS (5-15s) — graph contract_hash comparison, breaking change detection, consumer risk
4. DEPENDENCY (<5s) — graph.getCycles() for new circular deps, orphaned imports
5. TESTS (30s-5min) — graph-identified test files for changed code (getContextForTask → testFiles)
6. BEHAVIORAL (varies) — plan's custom verify steps from frontmatter

Output: { overall, layers[], fix_suggestions[], auto_fixable, graph_diff }
Rich terminal display with pass/fail/skip per layer, duration, specific error details.
Fix suggestions with auto_fixable flags for debugger/console.log removal.

Ledger integration: logError() for each failure, updateState({ verification: "passed" }) on full pass.

Programmatic: require('forge-verify/engine').verify({ cwd, files, planPath, dbPath, ... })
CLI flags: --root, --files, --plan, --db, --baseline, --layer, --fail-fast, --json, --silent, --no-ledger

## Forge Commands
- /forge:init — Build code graph and initialize project
- /forge:graph-status — Show code graph health, stats, hotspots
- /forge:impact <file-or-phase> — Impact analysis shortcut
- /forge:graph visualize — Generate and open HTML dashboard
