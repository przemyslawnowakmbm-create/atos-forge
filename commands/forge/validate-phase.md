---
name: forge:validate-phase
description: Validate phase plans before execution — checks completeness, dependencies, and feasibility
argument-hint: "<phase>"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
argument-instructions: |
  Parse the argument as a phase number.
  Example: /forge:validate-phase 3
---

$ARGUMENTS: phase number

Load and follow @atos-forge/workflows/validate-phase.md
