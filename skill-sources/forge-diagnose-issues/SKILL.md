---
name: forge-diagnose-issues
description: Orchestrate parallel debug agents to investigate UAT gaps and find root causes
argument-hint: (called automatically by forge-verify-work)
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
---

<execution_context>
@~/.claude/atos-forge/references/agent-directives.md
@~/.claude/atos-forge/workflows/diagnose-issues.md
</execution_context>

<objective>
Diagnose UAT gaps by spawning parallel debug agents — one per gap — then update UAT.md with root causes and hand off to plan-phase --gaps.

**Orchestrator role:** Parse gaps from UAT.md, spawn forge-debugger agents in parallel with symptoms pre-filled, collect root causes, update UAT.md, hand off to verify-work.

**Why subagents:** Each gap investigation is independent and burns context fast. Parallel agents find all root causes simultaneously instead of sequentially.
</objective>

<context>
UAT file: $ARGUMENTS (path to UAT.md, e.g. .planning/phases/XX-name/N-UAT.md)

**Load the UAT file to extract gaps:**
Read the Gaps section for failed/blocker items with their truth, reason, severity, and test number.
</context>

<process>
Execute the diagnose-issues workflow from @~/.claude/atos-forge/workflows/diagnose-issues.md end-to-end.

Steps in order:
1. parse_gaps — Extract all failed/blocker gaps from UAT.md Gaps section
2. report_plan — Show user which gaps will be diagnosed and how
3. spawn_agents — Spawn one forge-debugger agent per gap in a single message (parallel)
4. collect_results — Parse root causes from each agent return
5. update_uat — Add root_cause, artifacts, missing, debug_session fields to each gap in UAT.md; set status to "diagnosed"; commit
6. report_results — Display diagnosis table and return to verify-work orchestrator

Do NOT offer manual next steps after completion — verify-work handles the rest.
</process>

<success_criteria>
- [ ] Gaps parsed from UAT.md Gaps section
- [ ] Debug agents spawned in parallel (one per gap)
- [ ] Root causes collected from all agents
- [ ] UAT.md gaps updated with root_cause, artifacts, missing, debug_session
- [ ] UAT.md status updated to "diagnosed" and committed
- [ ] Hand off to verify-work for automatic planning
</success_criteria>
