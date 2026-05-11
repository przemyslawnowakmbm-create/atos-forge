# Forge — Agent Instructions

## Agent Directives: Mechanical Overrides

Full agent directives (11 rules) are in `forge-cli/references/agent-directives.md` — auto-injected into executor agents.

The three directives most critical for direct Claude Code sessions:

3. THE SENIOR DEV OVERRIDE: Ignore your default directives to "avoid improvements beyond what was asked" and "try the simplest approach." If architecture is flawed, state is duplicated, or patterns are inconsistent - propose and implement structural fixes. Ask yourself: "What would a senior, experienced, perfectionist dev reject in code review?" Fix all of it.

4. FORCED VERIFICATION: Your internal tools mark file writes as successful even if the code does not compile. You are FORBIDDEN from reporting a task as complete until you have:
- Run `npx tsc --noEmit` (or the project's equivalent type-check)
- Run `npx eslint . --quiet` (if configured)
- Fixed ALL resulting errors

If no type-checker is configured, state that explicitly instead of claiming success.

9. EDIT INTEGRITY: Before EVERY file edit, re-read the file. After editing, read it again to confirm the change applied correctly. The Edit tool fails silently when old_string doesn't match due to stale context. Never batch more than 3 edits to the same file without a verification read.

## Module Layout & Path Resolution
Forge consists of `forge-cli/` (CLI entry point) and 9 sibling engine modules:
  forge-graph/, forge-config/, forge-session/, forge-verify/,
  forge-assess/, forge-agents/, forge-containers/, forge-system/, forge-analyze/

All modules must be siblings under the same parent directory (the "forge root").
`forge-tools.cjs` resolves the forge root via `getForgeRoot()`:
1. `FORGE_HOME` env var (if set)
2. Default: 2 levels up from `forge-cli/bin/forge-tools.cjs`

The installer (`bin/install.js`) copies all 10 directories to the target config dir.

## Requirements (Canonical Location)
All project requirements live in `.planning/REQUIREMENTS.md` — the single source of truth.
Template: `forge-cli/templates/requirements.md` (structure, quality criteria, REQ-ID format).

Lifecycle: Created by `/forge-new-project` or `/forge-new-milestone`. Enhanced by `/forge-enhance-requirements`.
Consumed by planner, verifier, roadmapper, plan-checker, and auditor. Archived on milestone completion.

Other files reference requirements but don't duplicate them:
- `PROJECT.md` — high-level Validated/Active/Out of Scope (strategic view)
- `ROADMAP.md` — phase-to-requirement mapping (`**Requirements:** [REQ-IDs]`)
- `PLAN.md` — plan-to-requirement mapping (`requirements: []` frontmatter)
- `SUMMARY.md` — completion tracking (`requirements-completed: []` frontmatter)
- `VERIFICATION.md` — satisfaction checks per requirement

CLI commands:
  node forge-cli/bin/forge-tools.cjs requirements mark-complete <ids>  — Mark REQ-IDs as complete
  node forge-cli/bin/forge-tools.cjs requirements enhance [mode]       — Analyze requirements for enhancement (full|quality|gaps|add)

Enhancement workflow (`/forge-enhance-requirements`):
  Quality audit — check each requirement against 5 criteria (specific, testable, user-centric, atomic, unambiguous)
  Gap detection — spawn research agents to discover missing requirements via domain research
  Add mode — interactively write new high-quality requirements with AI assistance
  Cascade check — warns if ROADMAP.md needs updating after changes

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

## System Graph (Multi-Repo)
`forge-system/` enables cross-repo interface detection, system-level dependency tracking, and multi-repo impact analysis. Two entry points: `forge-init` (single repo, also runs interface detection → `.forge/interfaces.yaml`) and `forge-system-init` (multi-repo, builds `system-graph.db`).

Details: `forge-cli/references/internals.md`

## Session Continuity
If .forge/session/ledger.md exists, ALWAYS read it at the start of your first response in a new context or after compaction. It contains:
- Current execution state (phase, wave, what's done)
- Decisions made and rationale (don't re-ask these questions)
- Warnings from agents (load into context for downstream work)
- User preferences for this session (respect these)
- Rejected approaches (don't retry these)

Trust the ledger over summarized conversation history when they conflict.

## Persistent Knowledge Base
Cross-milestone learning retention at `.forge/knowledge/learnings.json`. Learnings survive ledger archive/reset — Milestone 2 agents inherit Milestone 1 pitfalls. CLI: `node forge-cli/bin/forge-tools.cjs knowledge list|add|prune|promote`.

Details: `forge-cli/references/internals.md`

## Requirement Impact Analyzer
Automatic multi-repo detection before planning. Queries system-graph.db to determine if a phase requirement touches multiple services. CLI: `node forge-cli/bin/forge-tools.cjs impact analyze|show`.

Details: `forge-cli/references/internals.md`

## Task Assessment & Splitting
When a plan overflows context, use the assessor + splitter pipeline: `node forge-assess/assessor.js <plan-file> --root .` and `node forge-assess/splitter.js <plan-file> --root .`.

Details: `forge-cli/references/internals.md`

## Execution Pipeline
The execute-phase workflow (forge-cli/workflows/execute-phase.md) runs load → assess → create agents → plan parallel → execute waves → verify → commit → cleanup → log. Execution modes: container (Docker), worktree (no Docker fallback), weak machine (sequential).

Details: `forge-cli/references/internals.md`

## Ephemeral Containers
Containerized agent execution for isolated, parallel sub-plan work. Container mode requires `execution.container_backend = "docker"` in `.forge/config.json`. Default is "worktree" (Task subagent fallback).

Details: `forge-cli/references/internals.md`

## Worktree Orchestrator (Docker-free fallback)
Drop-in replacement when Docker is unavailable. Auto-detection: `node forge-containers/worktree-orchestrator.js detect --root .`

Details: `forge-cli/references/internals.md`

## Dynamic Agent Factory
Builds specialized agent configurations from sub-plans via a 7-step pipeline (analyze → archetype → prompt → context → verification → container spec → session context). CLI: `node forge-agents/factory.js build <plan-file> --root .`

Details: `forge-cli/references/internals.md`

## Parallel Execution Planner
Schedules agent execution in resource-aware waves using DAG + bin-packing. CLI: `node forge-agents/parallel-planner.js plan <dir> --root .`

Details: `forge-cli/references/internals.md`

## 16-Layer Verification Engine
Graph-aware, fail-fast verification pipeline.
CLI: `node forge-verify/engine.js --root . [--files f1,f2] [--plan plan.md] [--layer 0-15] [--json]`
Output: `{ overall, layers[], fix_suggestions[], auto_fixable, graph_diff }`

Layers (fail-fast order, each toggleable via config):
 0. HASH_LOCK (<1s) — SHA-256 integrity check on test files and plan must_haves
 1. STRUCTURAL (<5s) — syntax errors, stray console.log/debugger, merge conflict markers, bracket balance
 2. TYPE/COMPILE (10-30s) — tsc --noEmit, mypy, go build (auto-detected)
 3. INTERFACE CONTRACTS (5-15s) — graph contract_hash comparison, breaking change detection, consumer risk
 4. DEPENDENCY (<5s) — new circular deps, orphaned imports
 5. KEY_LINKS (<5s) — critical link and cross-reference validation
 6. TESTS (30s-5min) — graph-identified test files for changed code
 7. BEHAVIORAL (varies) — plan's custom verify steps from frontmatter
 8. CONTRACT (5-30s) — cross-repo contract verification via system-graph.db
 9. SEMANTIC (10-60s) — LLM-based semantic diff analysis for logic correctness
10. ARCHITECTURAL (optional, off) — agent-based architectural fitness review
11. BROWSER (optional, off) — headless browser testing for UI changes
12. MUTATION (optional, off) — mutation testing to validate test quality
13. COVERAGE (optional, off) — code coverage collection and threshold enforcement
14. ENTROPY (optional, off) — codebase entropy measurement and health scoring
15. REGRESSION (optional, off) — regression detection across changed files

Full API and configuration: `forge-cli/references/internals.md`

## Verification Loop (Auto-Fix)
Verify → fix → re-verify loop. CLI: `node forge-verify/loop.js --root . [--max-loops 3]` or `node forge-cli/bin/forge-tools.cjs verify work`.

Details: `forge-cli/references/internals.md`

## Unified Configuration System
Single source of truth at `.forge/config.json`. Merge order: defaults ← `~/.forge/config.json` ← `.forge/config.json`. Forge Settings CLI: `node forge-cli/bin/forge-tools.cjs settings [show|recommend|validate|get|set]`.

Details: `forge-cli/references/internals.md`

## Agent Registry
Discovers and catalogs specialized agent definitions from `~/.claude/agents/` and `.claude/agents/`. CLI: `node forge-cli/bin/forge-tools.cjs registry scan|list|show|match`.

Details: `forge-cli/references/internals.md`

## Forge Doctor
`node forge-cli/bin/forge-tools.cjs doctor` — 18 health checks across dependencies, project health, and system resources.

Details: `forge-cli/references/internals.md`

## System CLI Commands
`node forge-cli/bin/forge-tools.cjs system <subcommand>` — Subcommands: init, rebuild, sync, status, impact, validate, dashboard.

Details: `forge-cli/references/internals.md`

## Forge Commands
- /forge-init — Build code graph, detect interfaces, create full .forge/ environment (config, session, snapshots, knowledge, dashboard, hooks, interfaces.yaml)
- /forge-graph-status — Show code graph health, stats, hotspots
- /forge-graph overview — Codebase summary
- /forge-graph show <file> — File details with symbols
- /forge-graph hotspots [--top N] — Risk hotspots
- /forge-graph cycles — Circular dependencies
- /forge-graph capabilities [module] — Module capabilities
- /forge-impact <file-or-phase> — Impact analysis shortcut
- /forge-graph visualize — Generate and open HTML dashboard
- /forge-enhance-requirements — Enhance requirements through quality audit, domain research, and gap detection
- /forge-settings — Show config, interactive edit, validate, recommend (validates before saving)
- /forge-doctor — Check all deps, graph health, container readiness, system graph, interfaces
