<overview>
Code graph integration for A-Forge framework. The code graph provides dependency-aware planning, impact analysis, and risk assessment powered by tree-sitter AST parsing and SQLite.
</overview>

<core_principle>

**Query before you change. Assess before you ship.**

The code graph exists so agents never modify a file without understanding its consumers, module boundaries, and risk profile. All graph features are optional — if `.forge/graph.db` doesn't exist, commands fall back to original behavior with a warning.
</core_principle>

<graph_commands>

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/forge:init` | Build code graph, install hooks, detect capabilities | First time setup, or when graph is stale |
| `/forge:graph-status` | Show freshness, stats, hotspots, boundaries | Before planning, to understand codebase health |
| `/forge:impact <file-or-phase>` | Analyze change impact for file or phase | Before cross-module changes, during plan review |

</graph_commands>

<agent_rules>

## Mandatory Agent Behaviors

1. **Before modifying any file**, query the code graph for its consumers and dependencies:
   ```bash
   node ~/.claude/atos-forge/bin/forge-tools.cjs graph impact "src/path/to/file.ts"
   ```

2. **Always check impact before cross-module changes.** If a file's consumers span multiple modules, the change is higher risk and needs careful review.

3. **During planning**, the graph context is automatically injected into the planner prompt via `<code_graph_intelligence>`. Use it to:
   - Identify which modules a plan touches
   - Understand stability ratings of affected modules
   - Check required capabilities (database, auth, API, etc.)
   - Assess risk level before committing to an approach

4. **During execution**, impact analysis runs automatically before each phase. HIGH or CRITICAL risk triggers a confirmation gate.

5. **After execution**, the graph updater runs automatically in the background to keep the graph fresh.

</agent_rules>

<query_examples>

## Programmatic API (from Node.js)

```javascript
const { GraphQuery, getConsumers, getImpact, getModule, getHotspots,
        getContextForTask, getCapabilities, searchSymbol,
        getModuleBoundaries, getRiskAssessment, getCycles,
        getOverview, getGraphDiff } = require('../../forge-graph/query');

// Get impact analysis for a file
const impact = getImpact('.forge/graph.db', 'src/auth/login.ts');
// Returns: { file, exported, directConsumers, transitiveImpact, risk, moduleBoundaries }

// Get full context for planning a set of files
const context = getContextForTask('.forge/graph.db', [
  'src/api/users.ts',
  'src/models/user.ts'
]);
// Returns: { files, risk, moduleBoundaries, capabilities, summary }

// Check module boundaries
const boundaries = getModuleBoundaries('.forge/graph.db');
// Returns: [{ source_module, target_module, dependency_count, files }]

// Find consumers of a symbol
const consumers = getConsumers('.forge/graph.db', 'UserService');
// Returns: [{ source_file, import_name, module }]

// Get risk hotspots
const hotspots = getHotspots('.forge/graph.db', 10);
// Returns: [{ path, loc, complexity_score, changes_30d, consumer_count, risk_score }]

// Detect circular dependencies
const cycles = getCycles('.forge/graph.db');
// Returns: { cycles, count, byModule }
```

## CLI Commands (from forge-tools.cjs)

```bash
# Build/rebuild graph
node ~/.claude/atos-forge/bin/forge-tools.cjs graph init

# Graph health overview
node ~/.claude/atos-forge/bin/forge-tools.cjs graph status

# Impact for a single file
node ~/.claude/atos-forge/bin/forge-tools.cjs graph impact "src/auth/login.ts"

# Impact for all files in a phase
node ~/.claude/atos-forge/bin/forge-tools.cjs graph impact --phase 3

# Context for task planning
node ~/.claude/atos-forge/bin/forge-tools.cjs graph context "src/api/users.ts" "src/models/user.ts"
```

## Direct query.js CLI

```bash
DB=".forge/graph.db"

# Rich overview with hotspots and module stats
node ~/forge-graph/query.js overview --db $DB

# Detailed file view with consumers and dependencies
node ~/forge-graph/query.js show src/auth/login.ts --db $DB

# Impact analysis with explanation
node ~/forge-graph/query.js impact src/auth/login.ts --explain --db $DB

# Search symbols across codebase
node ~/forge-graph/query.js search "UserService" --db $DB

# Module detail with files and capabilities
node ~/forge-graph/query.js module auth --db $DB

# Hotspots ranked by risk
node ~/forge-graph/query.js hotspots --limit 10 --db $DB

# Circular dependency detection
node ~/forge-graph/query.js cycles --db $DB

# Module boundary crossings
node ~/forge-graph/query.js boundaries --db $DB

# Capability detection
node ~/forge-graph/query.js capabilities --db $DB

# JSON output for any command
node ~/forge-graph/query.js impact src/auth/login.ts --db $DB --json
```

</query_examples>

<risk_levels>

## Risk Assessment

| Level | Score | Meaning | Action |
|-------|-------|---------|--------|
| LOW | 0-3 | Few consumers, single module | Proceed normally |
| MEDIUM | 4-6 | Multiple consumers or module boundary | Review consumers list |
| HIGH | 7-8 | Many consumers across modules | Extra test coverage, peer review |
| CRITICAL | 9-10 | Core infrastructure, many transitive dependents | Incremental changes, confirmation required |

Risk factors:
- **Consumer count**: More consumers = higher risk
- **Module boundaries crossed**: Cross-module changes ripple further
- **Module stability**: Changing a "stable" module is riskier than "volatile" one
- **Transitive depth**: Deep dependency chains amplify impact
- **Complexity score**: High-complexity files are harder to change safely

</risk_levels>

<workflow_integration>

## How the Graph Integrates with Workflows

### Plan Phase (automatic)
1. `forge-tools.cjs init plan-phase` includes `graph_available`, `graph_context` in JSON output
2. Step 7.5 in `plan-phase.md` loads graph context if available
3. Planner prompt receives `<code_graph_intelligence>` block with:
   - Risk level and reasons
   - Module boundaries that will be crossed
   - Required capabilities per module
   - Constraint: "Plans touching HIGH-risk files MUST include verification steps"

### Execute Phase (automatic)
1. `forge-tools.cjs init execute-phase` includes `graph_available`, `graph_risk`, `graph_boundaries`, `graph_capabilities`
2. Pre-execution `graph_impact_check` step runs impact analysis on all phase files
3. HIGH/CRITICAL risk triggers AskUserQuestion confirmation gate
4. Post-execution `update_graph` step runs the incremental updater in background

### Graph Freshness
- Git post-commit hook (installed by `/forge:init`) runs the updater automatically
- If graph is >24 hours old, `/forge:graph-status` warns about staleness
- `/forge:init` can be re-run at any time to rebuild from scratch

</workflow_integration>

<database_schema>

## Key Tables

| Table | Purpose |
|-------|---------|
| `files` | All source files with path, module, LOC, language, hash |
| `symbols` | Exported symbols (functions, classes, types) with signatures |
| `dependencies` | Import relationships between files |
| `modules` | Detected modules with stability ratings |
| `interfaces` | Public API contracts with hash for change detection |
| `change_frequency` | Git churn data (7d/30d/90d changes, top changers) |
| `module_capabilities` | Detected capabilities per module (database, auth, API, etc.) |
| `graph_meta` | Build metadata (commit, timestamp, counts) |

Database location: `<project-root>/.forge/graph.db` (SQLite with WAL mode)

</database_schema>
