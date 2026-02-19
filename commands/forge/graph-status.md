---
name: forge:graph-status
description: Show code graph health — freshness, stats, hotspots, capabilities
allowed-tools:
  - Bash
  - Read
---
<objective>
Display the current state of the code graph: freshness, file/symbol/module counts, top hotspots, module boundaries, and detected capabilities.
</objective>

<process>

## 1. Load Graph Status

```bash
STATUS=$(node ~/.claude/atos-forge/bin/forge-tools.cjs graph status)
```

Parse JSON for: `graph_exists`, `meta`, `hotspots`, `modules`, `capabilities`.

**If `graph_exists` is false:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 A-Forge ► NO CODE GRAPH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No code graph found. Run `/forge:init` to build one.
```
Exit.

## 2. Display Graph Status

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 A-Forge ► CODE GRAPH STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Last updated:** {meta.last_build_time or meta.updated_at}
**Commit:** {meta.last_build_commit (first 8 chars)}
**Files:** {meta.file_count} | **Symbols:** {meta.symbol_count} | **Modules:** {meta.module_count} | **Dependencies:** {meta.dependency_count}

### Top 5 Risk Hotspots

| File | LOC | Complexity | Churn | Risk |
|------|-----|-----------|-------|------|
{for each hotspot: | path | loc | complexity_score | changes_30d | risk_score |}

### Modules

| Module | Files | Stability | Capabilities |
|--------|-------|-----------|-------------|
{for each module: | name | file_count | stability | capabilities |}

### Detected Capabilities

{Group capabilities by module, show capability name and confidence}
```

## 3. Freshness Warning

If `meta.last_build_time` is more than 24 hours ago, add:
```
⚠ Graph may be stale (last built {time_ago}). Run `/forge:init` to rebuild.
```

</process>
