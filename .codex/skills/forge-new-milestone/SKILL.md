---
name: forge-new-milestone
description: Start a new milestone cycle — update PROJECT.md and route to requirements
---

<execution_context>
@~/.codex/forge/forge-cli/references/agent-directives.md
@~/.codex/forge/forge-cli/workflows/new-milestone.md
@~/.codex/forge/forge-cli/references/questioning.md
@~/.codex/forge/forge-cli/references/ui-brand.md
@~/.codex/forge/forge-cli/templates/project.md
@~/.codex/forge/forge-cli/templates/requirements.md
</execution_context>

<objective>
Start a new milestone: questioning → research (optional) → requirements → roadmap.

Brownfield equivalent of new-project. Project exists, PROJECT.md has history. Gathers "what's next", updates PROJECT.md, then runs requirements → roadmap cycle.

**Creates/Updates:**
- `.planning/PROJECT.md` — updated with new milestone goals
- `.planning/research/` — domain research (optional, NEW features only)
- `.planning/REQUIREMENTS.md` — scoped requirements for this milestone
- `.planning/ROADMAP.md` — phase structure (continues numbering)
- `.planning/STATE.md` — reset for new milestone

**After:** `$forge-plan-phase [N]` to start execution.
</objective>

<context>
Milestone name: $ARGUMENTS (optional - will prompt if not provided)

**Load project context:**
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/MILESTONES.md
@.planning/config.json

**Load milestone context (if exists, from $forge-discuss-milestone):**
@.planning/MILESTONE-CONTEXT.md
</context>

<process>
Execute the new-milestone workflow from @~/.codex/forge/forge-cli/workflows/new-milestone.md end-to-end.
Preserve all workflow gates (validation, questioning, research, requirements, roadmap approval, commits).
</process>
