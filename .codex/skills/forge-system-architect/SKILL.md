---
name: forge-system-architect
description: Design multi-service system architecture through relentless grilling — produces .forge-system/SYSTEM-ARCHITECTURE.md
argument-hint: "[--services <s1,s2,...>]"
---

<execution_context>
@~/.codex/forge/forge-cli/references/agent-directives.md
@~/.codex/forge/forge-cli/workflows/system-architect.md
@.planning/PROJECT.md
</execution_context>

<objective>
Design the system-level architecture for a multi-service system through structured grilling.
Produces `.forge-system/SYSTEM-ARCHITECTURE.md` which must be approved before per-service
`/forge-architect` can proceed.
</objective>

<context>
Arguments: $ARGUMENTS

The system-architect workflow gates all per-service architecture work: SYSTEM-ARCHITECTURE.md
must reach `status: approved` before any `/forge-architect` run. It defines service boundaries,
communication topology, data ownership, contracts, and cross-cutting concerns.

Run this workflow BEFORE per-service `/forge-architect` when the system involves multiple services.
</context>

<process>
Follow the system-architect workflow from `@~/.codex/forge/forge-cli/workflows/system-architect.md` end-to-end.

Preserve all workflow gates including:
- Service discovery (scan directories, PROJECT.md, or user enumeration)
- Context loading (all service requirements, existing per-service architectures, system glossary)
- Grilling phase (service boundaries, communication patterns, data ownership, auth strategy, ADRs)
- System architecture document production (.forge-system/SYSTEM-ARCHITECTURE.md)
- Glossary updates (.forge-system/glossary.md)
- Approval gate before signalling readiness to per-service /forge-architect runs
</process>
