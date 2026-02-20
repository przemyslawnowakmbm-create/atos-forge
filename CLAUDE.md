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

Layers (fail-fast order, each toggleable via config):
1. STRUCTURAL (<5s) — syntax errors, stray console.log/debugger, merge conflict markers, bracket balance
2. TYPE/COMPILE (10-30s) — tsc --noEmit, mypy, go build (auto-detected from file extensions + graph capabilities)
   - Broad tsconfig.json discovery: cwd → parent dirs → src/ → packages/* (monorepo)
   - Fallback: `tsc --noEmit --strict` on changed .ts files directly when no tsconfig found
   - Override: `verification.type_check_command` in config
3. INTERFACE CONTRACTS (5-15s) — graph contract_hash comparison, breaking change detection, consumer risk
4. DEPENDENCY (<5s) — graph.getCycles() for new circular deps, orphaned imports
5. TESTS (30s-5min) — graph-identified test files for changed code (getContextForTask → testFiles)
   - Override: `verification.test_command` in config
6. BEHAVIORAL (varies) — plan's custom verify steps from frontmatter

Output: { overall, layers[], fix_suggestions[], auto_fixable, graph_diff }
Rich terminal display with pass/fail/skip per layer, duration, specific error details.
Fix suggestions with auto_fixable flags for debugger/console.log removal.

Ledger integration: logError() for each failure, updateState({ verification: "passed" }) on full pass.

Configuration in .forge/config.json or .planning/config.json (verification section):
  layers (per-layer boolean toggles), auto_fix (true/false), max_fix_loops,
  type_check_command (override tsc), test_command (override test runner), test_timeout.

Programmatic: require('forge-verify/engine').verify({ cwd, files, planPath, dbPath, ... })
Additional exports: findTsConfig(cwd), loadVerificationConfig(cwd)
CLI flags: --root, --files, --plan, --db, --baseline, --layer, --fail-fast, --json, --silent, --no-ledger

## Verification Loop (Auto-Fix)
Verify → fix → re-verify loop with loop detection and escalation:
  node forge-verify/loop.js --root . [--files f1,f2] [--plan plan.md] [--max-loops 3] [--commit] [--json]
  node atos-forge/bin/forge-tools.cjs verify work [--files f1,f2] [--max-loops 3] [--commit] [--no-agent]

Flow: verify → PASS? done : analyze fixability → build fix agent → run via worktree → re-verify → max N loops → escalate.
Auto-fixable: type errors (L2), missing imports (L4), assertion mismatches (L5), interface breaks (L3), syntax issues (L1).
Not auto-fixable: behavioral failures (L6) → escalate to human.

Loop prevention:
- Same patch hash twice → stuck, escalate
- Fix introduces NEW layer failures → revert changes, escalate
- Max loops (default 3) exceeded → escalate

Fix agents receive session_context from ledger (warnings, decisions, rejected approaches).
Each fix attempt logged: ledger.logError({ error, fix_applied, auto_fixed: true, fix_loop: N }).

Wave integration:
- verifyAfterWave(opts) — lighter check (layers 1-4), max 2 loops, after each wave
- verifyFull(opts) — all 6 layers, max 3 loops, after all waves complete

Programmatic: require('forge-verify/loop').verifyLoop({ cwd, files, maxLoops, commit, ... })
Returns: { overall, loops[], fix_summary[], graph_diff, learnings[], escalated, escalation_reason }

## Unified Configuration System
Single source of truth for all Forge configuration:
  node forge-config/config.js (module, no CLI)

Merge order: defaults ← ~/.forge/config.json (global) ← .forge/config.json (project).
Deep merge: objects merged recursively, arrays replaced, nulls preserved.

Schema sections (9 primary + 4 legacy):
- project: { name, description }
- graph: { enabled, auto_update, languages, ignore_patterns, module_detection, capability_detection, dashboard_auto_regenerate, snapshot_retention }
- execution: { mode, container_backend, context_budget, assessment_threshold, auto_split, max_fix_loops, ... }
- containers: { max_concurrent, max_memory_per_container, max_cpu_per_container, timeout_seconds, network_access, cleanup_on_exit, image_prefix }
- agents: { factory_enabled, default_archetype, model_profiles: { quality, balanced, budget }, active_profile }
- verification: { layers: { structural, type_check, interface_contracts, dependency_analysis, tests, behavioral }, auto_fix, test_command, type_check_command }
- session: { ledger_enabled, ledger_max_tokens, auto_compact, archive_on_phase_complete }
- display: { rich_output, inline_graph_context, show_graph_diff, show_agent_learnings }
- git: { atomic_commits, commit_prefix, branching_strategy, sign_commits }
- Legacy: workflow, parallelization, gates, safety (backward compat with .planning/config.json)

Key functions:
  loadConfig(cwd) → { config, sources: { defaults, global, project }, projectSource }
  resolveEffective(cwd) → config + _system (cores, RAM) + containers._resolved (concrete limits)
  validate(config) → { valid, errors[] }
  saveProjectConfig(cwd, config) → writes .forge/config.json

Section accessors (backward-compatible return shapes):
  getVerification(cwd) — maps lowercase→UPPERCASE for engine.js/loop.js
  getContainers(cwd) — matches old loadContainerConfig shape
  getExecution(cwd) — matches old loadForgeConfig shape
  getLegacyToolsConfig(cwd) — flat shape for forge-tools.cjs

All existing consumers delegate to unified config with try/catch fallback to original inline logic.

## Forge Settings
  node atos-forge/bin/forge-tools.cjs settings [show|recommend|validate|get|set]

Subcommands:
- (none) or show — display effective config with source attribution (D=default, G=global, P=project)
- recommend — detect system capabilities, suggest optimal settings
- validate — run schema validation on merged config
- get <key.path> — read a specific config value (dot notation)
- set <key.path> <value> — update project config, validates after save

## Forge Doctor
  node atos-forge/bin/forge-tools.cjs doctor [--raw for JSON]
  node forge-config/doctor.js --root . [--json]

15 health checks across 3 categories:
1. Dependencies (7): Node.js, Git, Docker, Claude CLI, tree-sitter, better-sqlite3, chalk
2. Project Health (7): Configuration, Code Graph (with staleness warning >24h), Dashboard, Session Ledger, Snapshots, Git Hooks (post-commit forge updater), Docker Images (forge agent images)
3. System (1): Resources (cores, RAM, max concurrent agents)

Box-drawing terminal output with status icons. Returns { checks[], summary: { ok, warn, fail, skip } }.

## Forge Commands
- /forge:init — Build code graph, create full .forge/ environment (config, session, snapshots, knowledge, dashboard, hooks)
- /forge:graph-status — Show code graph health, stats, hotspots
- /forge:graph overview — Codebase summary
- /forge:graph show <file> — File details with symbols
- /forge:graph hotspots [--top N] — Risk hotspots
- /forge:graph cycles — Circular dependencies
- /forge:graph capabilities [module] — Module capabilities
- /forge:impact <file-or-phase> — Impact analysis shortcut
- /forge:graph visualize — Generate and open HTML dashboard
- /forge:settings — Show config, interactive edit, validate, recommend (validates before saving)
- /forge:doctor — Check all deps, graph health, container readiness, system
