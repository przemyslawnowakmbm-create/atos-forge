---
name: forge-research-refresh
description: Refresh stale research dimensions by re-running only expired ones
---

<execution_context>
@~/.codex/forge/forge-cli/references/agent-directives.md
@~/.codex/forge/forge-cli/workflows/research-refresh.md
</execution_context>

<objective>
Refresh stale research dimensions in `.planning/research/` by archiving expired files and re-running only the dimensions that have passed their `valid_until` date.

**How it works:**
1. Scan all RESEARCH.md files and extract `valid_until` + `dimension` from frontmatter
2. Identify stale dimensions (expired date, missing date, or changed package.json)
3. Archive stale files to `.planning/research/archive/{YYYY-MM-DD}/`
4. Spawn forge-project-researcher agents for each stale dimension with prior context
5. Leave fresh dimensions untouched
6. Report what was refreshed vs skipped

**Output:** Updated `.planning/research/` with fresh RESEARCH.md files for stale dimensions
</objective>

<context>
Options: $ARGUMENTS (optional)
- `--use-stale`: Skip refresh, use existing research even if expired
- `--force`: Refresh ALL dimensions regardless of valid_until
- `--dimension <name>`: Refresh only a specific named dimension

**Load project state:**
@.planning/research/ (scan all RESEARCH.md files)
@.planning/PROJECT.md (required for researcher context)

**Load if available:**
@.planning/REQUIREMENTS.md
@.planning/research/SUMMARY.md
</context>

<process>
Execute the research-refresh workflow from @~/.codex/forge/forge-cli/workflows/research-refresh.md end-to-end.

Steps in order:
1. Scan research files — read all `.planning/research/*.md`, extract `valid_until` and `dimension`
2. Identify stale dimensions — compare valid_until to today; check package.json mtime
3. Archive prior research — move stale files to `.planning/research/archive/{YYYY-MM-DD}/`
4. Re-research stale dimensions — spawn forge-project-researcher per stale dimension with prior summary as context
5. Skip fresh dimensions — report which are still valid and their expiry dates
6. Summary — report refreshed vs skipped dimensions and archive location

Apply --use-stale, --force, or --dimension filters before step 2 if provided.
</process>

<success_criteria>
- [ ] All research files scanned for valid_until
- [ ] Stale dimensions correctly identified
- [ ] Stale files archived before overwriting
- [ ] Fresh RESEARCH.md produced for each stale dimension
- [ ] Fresh dimensions left untouched
- [ ] Summary report shows refreshed and skipped dimensions
</success_criteria>
