---
name: forge-cleanup
description: Archive accumulated phase directories from completed milestones
---

<execution_context>
@~/.claude/forge-cli/references/agent-directives.md
@~/.claude/forge-cli/workflows/cleanup.md
</execution_context>

<objective>
Archive phase directories from completed milestones into `.planning/milestones/v{X.Y}-phases/`.

Use when `.planning/phases/` has accumulated directories from past milestones.
</objective>



<process>
Follow the cleanup workflow at @~/.claude/forge-cli/workflows/cleanup.md.
Identify completed milestones, show a dry-run summary, and archive on confirmation.
</process>
