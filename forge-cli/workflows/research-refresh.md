---
description: Refresh stale research dimensions
command: /forge-research-refresh
---

# Research Refresh Workflow

Refreshes stale research by re-running only the dimensions that have expired.

## Steps

### 1. Scan Research Files
Read all RESEARCH.md files in `.planning/research/`:
- Extract `valid_until` from YAML frontmatter
- Extract `dimension` from frontmatter
- Compare against today's date

### 2. Identify Stale Dimensions
A dimension is stale if:
- `valid_until` is before today's date
- `valid_until` is missing (treat as immediately stale)
- `package.json` has changed since research was created (dependency landscape shift)

### 3. Archive Prior Research
For each stale dimension:
- Create archive directory: `.planning/research/archive/{YYYY-MM-DD}/`
- Move stale RESEARCH.md to archive
- Log archival in session ledger

### 4. Re-Research Stale Dimensions
For each stale dimension:
- Spawn forge-project-researcher (subagent_type="forge-project-researcher")
- Pass the dimension name and previous research summary as context
- Researcher produces fresh RESEARCH.md with updated valid_until

### 5. Skip Fresh Dimensions
Dimensions where `valid_until` is still in the future are left untouched.
Report which dimensions were skipped and their expiry dates.

### 6. Summary
Report:
- Dimensions refreshed: [list]
- Dimensions still fresh: [list]
- Archive location: .planning/research/archive/{date}/

## Options
- `--use-stale`: Skip refresh, use existing research even if expired
- `--force`: Refresh ALL dimensions regardless of valid_until
- `--dimension <name>`: Refresh only a specific dimension
