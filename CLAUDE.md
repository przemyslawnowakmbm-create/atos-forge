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
Each sub-plan includes graph_context and session_context loading instructions.

## Forge Commands
- /forge:init — Build code graph and initialize project
- /forge:graph-status — Show code graph health, stats, hotspots
- /forge:impact <file-or-phase> — Impact analysis shortcut
- /forge:graph visualize — Generate and open HTML dashboard
