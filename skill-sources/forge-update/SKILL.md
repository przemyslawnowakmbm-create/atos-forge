---
name: forge-update
description: Update Forge to the latest version
allowed-tools:
  - Bash
  - Read
  - Write
---

<execution_context>
@~/.claude/forge-cli/references/agent-directives.md
@~/.claude/forge-cli/workflows/update.md
</execution_context>

<objective>
Check for Forge updates via npm, display the changelog for versions between the installed and latest, obtain user confirmation, and execute a clean installation with cache clearing.
</objective>

<process>
Follow the update workflow at @~/.claude/forge-cli/workflows/update.md.

The workflow handles all logic including:
1. Detecting installed version and installation scope (local vs global)
2. Fetching the latest version from npm
3. Displaying the changelog diff for skipped versions
4. Prompting the user for confirmation before proceeding
5. Running the installer with cache clearing
6. Verifying the update succeeded
</process>
