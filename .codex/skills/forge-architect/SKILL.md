---
name: forge-architect
description: Design per-service architecture through relentless grilling — produces .planning/ARCHITECTURE.md
argument-hint: "[--service <name>]"
---

<execution_context>
@~/.codex/forge/forge-cli/references/agent-directives.md
@~/.codex/forge/forge-cli/workflows/architect.md
@.planning/REQUIREMENTS.md
@.planning/PROJECT.md
</execution_context>

<objective>
Design the per-service architecture for this project through structured grilling.
Produces `.planning/ARCHITECTURE.md` which must be approved before `/forge-plan-phase` can proceed.
</objective>

<context>
Arguments: $ARGUMENTS

The architect workflow gates downstream planning: ARCHITECTURE.md must reach `status: approved`
before any plan-phase run. If SYSTEM-ARCHITECTURE.md exists at `.forge-system/`, this service's
architecture must conform to system-level constraints.
</context>

<process>
Follow the architect workflow from `@~/.codex/forge/forge-cli/workflows/architect.md` end-to-end.

Preserve all workflow gates including:
- Context loading (requirements, project, system constraints, existing codebase map)
- Grilling phase (requirements clarification, module boundaries, ADRs)
- Architecture document production (.planning/ARCHITECTURE.md)
- Glossary updates (.forge/glossary.md)
- Approval gate before signalling readiness to /forge-plan-phase
</process>
