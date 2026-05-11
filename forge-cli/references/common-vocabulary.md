# Forge Common Vocabulary

## Plan Contract Terms

**must_haves** — Machine-verifiable acceptance criteria embedded in plan YAML frontmatter. Contains sub-fields: truths, key_links, artifacts. A plan is complete only when all must_haves pass verification.

**truths** — User-observable behaviors that must be true when a plan is complete. Each truth is a declarative statement verified by automated tests or runtime inspection.

**key_links** — File-to-file wiring requirements. Each entry specifies a source file, target file, connection mechanism (via), and optional regex pattern. Verified by the KEY_LINKS verification layer.

**artifacts** — Required output files with properties. Each entry specifies a path and optional constraints: min_lines, contains (substring), exports (symbols), provides (description).

**requirements** — REQ-IDs from .planning/REQUIREMENTS.md that this plan addresses. Used for traceability from requirement to implementation to verification.

**parent_contract** — When a plan is split into sub-plans, each sub-plan inherits the parent's contract (truths, key_links, artifacts filtered to relevant files). Ensures sub-plans collectively satisfy the parent.

## Session & State Terms

**CONTEXT.md** — Per-phase context file containing loaded project state, configuration, and graph data. Created by init commands, consumed by planner and executor agents.

**STATE.md** — Per-phase state tracking file recording current progress, completed plans, and verification results.

**SUMMARY.md** — Per-plan completion report with frontmatter (tests_passed, tests_failed) and Self-Check section. A plan is complete only when SUMMARY.md exists AND contains "Self-Check: PASSED".

**Locked Decisions** — Decisions recorded in the session ledger that must not be revisited. Agents receive these in their system prompt and must respect them without re-asking.

**frontmatter** — YAML metadata block at the top of a plan file, delimited by `---`. Contains wave, depends_on, autonomous, phase, plan, type, requirements, must_haves, files_modified, and other fields.

## Execution Terms

**wave** — A group of agents that execute in parallel within a phase. Wave N+1 starts only after Wave N completes and passes verification. Wave 0 is reserved for test-author agents.

**archetype** — Agent specialization determined by the factory: specialist (single module), integrator (3+ modules), careful (high risk), or general (fallback). Determines system prompt behavior rules and time estimates.

**Phase Boundary** — The transition between execution phases. Requires full verification (all layers), ledger archival, and knowledge promotion before the next phase begins.

**goal-backward** — Verification approach that starts from the desired end state (truths, artifacts, key_links) and works backward to check if each requirement is satisfied, rather than checking forward from code changes.

## Infrastructure Terms

**session ledger** — Markdown file (.forge/session/ledger.md) tracking decisions, warnings, preferences, and rejected approaches across a session. Protected by file locking for concurrent agent access.

**knowledge base** — Persistent learnings (.forge/knowledge/learnings.json) that survive ledger archive/reset. Types: warning, decision, pitfall, convention, preference. Auto-promoted from ledger on milestone completion.
