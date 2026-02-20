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
The execute-phase workflow automatically:
1. Assesses each plan for context overflow (forge-assess/assessor.js)
2. Splits overflowing plans into sub-plans (forge-assess/splitter.js)
3. Builds a dependency-aware execution DAG
4. Executes in waves (parallel within wave, sequential across waves)
5. After each wave: updates graph, takes snapshot, diffs, re-assesses remaining plans

Assessment happens both before execution AND between waves (plans may shrink after code changes).

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

## Forge Commands
- /forge:init — Build code graph and initialize project
- /forge:graph-status — Show code graph health, stats, hotspots
- /forge:impact <file-or-phase> — Impact analysis shortcut
- /forge:graph visualize — Generate and open HTML dashboard
