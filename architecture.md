# Forge — Architecture

> Ten plik opisuje aktualny stan architektury i plan rozwoju.
> Jest permanentny — aktualizowany z każdą zmianą architektoniczną.
> Ostatnia aktualizacja: 2026-03-11

---

## 1. Przegląd systemu

Forge to AI-powered spec-driven development system działający wewnątrz Claude Code. Buduje graf kodu (SQLite), zarządza pamięcią sesji, orkiestruje agentów w izolowanych kontenerach/worktree, i weryfikuje wyniki 8-warstwowym pipeline.

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code CLI                          │
│  /forge:* slash commands → workflows → agents                │
├─────────────┬──────────────┬────────────────┬───────────────┤
│ forge-graph │ forge-session│ forge-agents   │ forge-verify  │
│ (SQLite DB) │ (ledger,     │ (factory,      │ (8 layers,    │
│             │  decisions,  │  parallel-     │  auto-fix,    │
│             │  knowledge,  │  planner,      │  cache,       │
│             │  metrics,    │  output-schema)│  test-stubs)  │
│             │  crash-      │                │               │
│             │  recovery)   │                │               │
├─────────────┼──────────────┼────────────────┼───────────────┤
│ forge-assess│ forge-config │ forge-containers│ forge-system │
│ (assessor,  │ (config,     │ (Docker,       │ (multi-repo,  │
│  splitter)  │  doctor,     │  worktree,     │  interfaces,  │
│             │  settings)   │  resource-mgr) │  dashboard)   │
├─────────────┼──────────────┼────────────────┼───────────────┤
│ forge-auto  │ forge-       │ atos-forge/bin │ hooks/        │
│ (state      │  analyze     │ (forge-tools   │ (statusline,  │
│  machine,   │ (impact      │  + 21 lib/     │  context-     │
│  auto mode) │  analyzer)   │  modules)      │  monitor,     │
│ [PLANNED]   │              │                │  check-update)│
└─────────────┴──────────────┴────────────────┴───────────────┘
```

**Runtime:** Node.js 20+ | **Database:** SQLite (better-sqlite3) | **Air-gapped:** TAK

---

## 2. Moduły — aktualny stan

### 2.1 forge-graph/ — Code Graph Engine (SQLite)

**Status:** Zaimplementowany + rozszerzony

Serce systemu. Tree-sitter AST parsing → SQLite z 12 tabelami + 14 indeksami.

**Pliki:**
| Plik | Linii | Opis |
|------|-------|------|
| `builder.js` | 1281 | Full build: scan → parse AST → detect modules → write DB + conventions |
| `query.js` | 2474 | GraphQuery class: impact, hotspots, cycles, context-for-task, modules |
| `updater.js` | ~300 | Incremental: only changed files since last build |
| `schema.sql` | 141 | 12 tables, 14 indexes |
| `capability-detector.js` | ~400 | Per-module capability detection (testing, api, database...) |
| `convention-detector.js` | ~200 | Auto-detect naming, imports, exports, test framework |
| `module-detector.js` | ~200 | Module boundary detection |
| `dashboard-generator.js` | ~1500 | Self-contained HTML + D3.js (5 tabs) |
| `snapshot.js` | ~200 | Graph state snapshots for diffing |
| `install-hooks.js` | ~150 | Git hooks installation |

**Schema (graph.db):**
```
files           — path, module, language, LOC, complexity, is_test, is_config
symbols         — name, kind, file, line_start, line_end, exported, signature
dependencies    — source_file → target_file (import tracking)
modules         — name, root_path, file_count, stability
module_deps     — source_module → target_module
module_caps     — module × capability × confidence
interfaces      — name, file, kind, consumer_count, contract_hash
change_frequency— file, changes_7d/30d/90d, top_changers
warnings        — module, file, severity, source
agent_learnings — agent_id, module, type, content
graph_meta      — key/value store (conventions, build timestamp...)
```

**Planowane rozszerzenia grafu (z CGC):**
```sql
-- NOWE tabele do dodania:
CREATE TABLE IF NOT EXISTS call_graph (
    caller_symbol_id INTEGER REFERENCES symbols(id),
    callee_symbol_id INTEGER REFERENCES symbols(id),
    call_site_line   INTEGER,
    call_type        TEXT,  -- direct | method | constructor | callback
    PRIMARY KEY (caller_symbol_id, callee_symbol_id, call_site_line)
);

CREATE TABLE IF NOT EXISTS class_hierarchy (
    child_id    INTEGER REFERENCES symbols(id),
    parent_id   INTEGER REFERENCES symbols(id),
    relation    TEXT,  -- extends | implements | mixin
    PRIMARY KEY (child_id, parent_id)
);

CREATE TABLE IF NOT EXISTS dead_code (
    symbol_id   INTEGER PRIMARY KEY REFERENCES symbols(id),
    reason      TEXT,  -- no_callers | no_importers | unreachable
    confidence  REAL DEFAULT 0.0,
    detected_at TEXT DEFAULT (datetime('now'))
);
```

**Nowe query capabilities do dodania:**
- `getCallers(symbolId)` — kto wywołuje tę funkcję (function-level, nie file-level)
- `getCallees(symbolId)` — co wywołuje ta funkcja
- `getCallChain(symbolId, depth)` — N-hop call graph traversal
- `getClassHierarchy(symbolId)` — inheritance tree (extends/implements)
- `getDeadCode(module?)` — symbole bez callerów/importerów
- `getComplexity(threshold)` — symbole z complexity > threshold

**Nowe builder capabilities:**
- Function-level call extraction z Tree-sitter (CALLS relacje)
- Class inheritance extraction (extends/implements)
- Dead code detection (symbols with 0 consumers)
- File watcher (fs.watch → incremental rebuild)

### 2.2 forge-session/ — Session Memory

**Status:** Zaimplementowany + rozszerzony

**Pliki:**
| Plik | Linii | Opis |
|------|-------|------|
| `ledger.js` | 713 | Markdown ledger: decisions, warnings, errors, state |
| `decisions.js` | 230 | SQLite decisions.db: queryable, survives archival |
| `knowledge.js` | 507 | Persistent cross-milestone learnings (JSON) |

**Planowane nowe pliki:**
| Plik | Opis |
|------|------|
| `crash-recovery.js` | Lock files + session forensics + recovery briefing |
| `metrics.js` | Per-unit token/cost tracking, budget ceiling |

### 2.3 forge-agents/ — Agent Orchestration

**Status:** Zaimplementowany + rozszerzony

**Pliki:**
| Plik | Linii | Opis |
|------|-------|------|
| `factory.js` | 1469 | 7-step pipeline: analyze → archetype → prompt → context → verify → container → session |
| `parallel-planner.js` | ~500 | DAG scheduling, bin-packing into waves |
| `agent-output-schema.js` | 48 | Structured JSON output: findings, decisions, confidence |

**Factory intelligence (zaimplementowane):**
- Decision Registry integration (decisions.db → agent prompt)
- Fact-Grounding (graph exports/signatures → "Grounded Facts" section)
- Context Compression (3-level: FULL/INTERFACE/SUMMARY)
- Convention injection (naming, imports, test fw → prompt)
- Plan-Lock (locked_decisions → "LOCKED DECISIONS" section)
- Agent Memory Chain (previous findings → "Previous Agent Findings" section)
- Structured output instruction (json:agent-output block)
- Test stub inclusion (always_load test stubs for RED→GREEN)

### 2.4 forge-verify/ — Verification Pipeline

**Status:** Zaimplementowany + rozszerzony

**Pliki:**
| Plik | Linii | Opis |
|------|-------|------|
| `engine.js` | 1852 | 8-layer fail-fast verification + incremental mode |
| `loop.js` | 1250 | Auto-fix loop with stuck detection + escalation |
| `contract-layer.js` | ~500 | Cross-repo contract verification |
| `cache.js` | 55 | Content-addressed SHA-256 cache, TTL 2min |
| `test-stub-generator.js` | 133 | RED→GREEN test stubs from plan verification criteria |

**Warstwy:**
1. STRUCTURAL (<5s) — syntax, stray debugger/console.log, merge conflicts
2. TYPE/COMPILE (10-30s) — tsc --noEmit, mypy, go build
3. INTERFACE CONTRACTS (5-15s) — contract_hash comparison, breaking changes
4. DEPENDENCY (<5s) — circular deps, orphaned imports
5. TESTS (30s-5min) — graph-identified test files + test stubs
6. BEHAVIORAL (varies) — plan must_haves + locked_decisions + verification_must_check
7. CONTRACT (5-30s) — cross-repo code↔YAML drift, backward compat
8. ARCHITECTURAL (optional) — LLM-based architecture review

**Planowana nowa warstwa:**
9. BROWSER (optional) — Playwright-based UI verification for frontend

### 2.5 forge-assess/ — Task Assessment & Splitting

**Status:** Zaimplementowany + rozszerzony

**Pliki:**
| Plik | Linii | Opis |
|------|-------|------|
| `assessor.js` | 483 | Context overflow detection (INTERFACE-level token estimation) |
| `splitter.js` | 1212+ | 4 strategies: connected_component → module → concern → file |

### 2.6 forge-containers/ — Execution Isolation

**Status:** Zaimplementowany

**Pliki:**
| Plik | Linii | Opis |
|------|-------|------|
| `orchestrator.js` | 651 | Docker lifecycle + agent output parsing |
| `worktree-orchestrator.js` | 854 | Docker-free fallback via git worktrees |
| `config.js` | ~200 | Resource detection (CPU, RAM, max_concurrent) |
| `resource-manager.js` | ~150 | Semaphore + slot management |
| `container-spec.js` | ~200 | Image selection (node/python/full) |
| `agent-entrypoint.js` | ~200 | Container entrypoint: reads config, runs claude, collects patch |
| `agent-verifier.js` | ~150 | Lightweight container verifier |
| `patch-collector.js` | ~100 | git apply --3way |

**Planowane rozszerzenia:**
- Soft timeout: inject warning to agent after X min
- Idle watchdog: monitor git diff — kill if no changes > Y min
- Metrics collection: capture tokens/cost per agent run

### 2.7 forge-system/ — Multi-Repo System Graph

**Status:** Zaimplementowany

**Pliki:** builder.js, query.js, schema.sql, detect.js, validate.js, sync.js, system-init.js, dashboard.js

System-level SQLite (system-graph.db): services, interfaces, dependencies, teams, sync_log, service_metrics.

### 2.8 forge-config/ — Configuration

**Status:** Zaimplementowany

config.js (unified), doctor.js (17 health checks), settings.js (display/recommend).

**Schema sections:** project, graph, execution, containers, agents, verification, knowledge, impact_analysis, session, display, git, system, decisions.

### 2.9 forge-analyze/ — Requirement Impact Analyzer

**Status:** Zaimplementowany

analyzer.js: keyword extraction → interface search → impact analysis → scope detection (SINGLE_REPO vs MULTI_REPO).

### 2.10 atos-forge/ — CLI & Workflows

**Status:** Zaimplementowany + zmodularyzowany

- `bin/forge-tools.cjs` — 709L thin dispatcher
- `bin/lib/` — 21 modułów (core, frontmatter, state, config, phase, roadmap, milestone, verify, validate, template, scaffold, progress, graph, system, init, misc, ledger, knowledge, settings, doctor, impact)
- `workflows/` — 32 workflow definitions (.md)
- `templates/` — plan/summary/config templates
- `references/` — 5 reference docs

### 2.11 hooks/ — Claude Code Hooks

**Status:** Zaimplementowany

- `forge-statusline.js` — model, task, context bar + bridge file for monitor
- `forge-context-monitor.js` — PostToolUse: WARNING at 35%, CRITICAL at 25% remaining
- `forge-check-update.js` — background update check

### 2.12 commands/forge/ — Slash Commands

31 komend: new-project, discuss-phase, plan-phase, execute-phase, verify-work, validate-phase, add-tests, quick, progress, debug, health, settings, ...

### 2.13 agents/ — Specialized Agents

11 agentów: executor, planner, verifier, debugger, plan-checker, codebase-mapper, research-synthesizer, phase-researcher, project-researcher, roadmapper, integration-checker.

### 2.14 tests/

4 pliki testowe (helpers.cjs, core.test.cjs, frontmatter.test.cjs, misc.test.cjs) + 1 CLI test (forge-tools.test.cjs). Total: 101 testów.

---

## 3. Intelligence Layer — zaimplementowane (10 punktów)

| # | Feature | Plik | Status |
|---|---------|------|--------|
| 1 | Decision Registry (SQLite) | forge-session/decisions.js | DONE |
| 2 | Fact-Grounding (graph→prompt) | forge-agents/factory.js | DONE |
| 3 | Plan-Lock (locked_decisions) | factory.js + engine.js + planner + frontmatter | DONE |
| 4 | Test-First Pipeline (RED→GREEN) | forge-verify/test-stub-generator.js | DONE |
| 5 | Context Compression (3-level) | forge-agents/factory.js + assessor.js | DONE |
| 6 | Incremental Verification | forge-verify/engine.js + loop.js | DONE |
| 7 | Agent Memory Chain (structured JSON) | agent-output-schema.js + orchestrators | DONE |
| 8 | Smart Splitting (connected components) | forge-assess/splitter.js | DONE |
| 9 | Execution Cache | forge-verify/cache.js | DONE |
| 10 | Convention Detector | forge-graph/convention-detector.js | DONE |

---

## 4. Planowane rozszerzenia — z GSD-2

### 4.1 Crash Recovery (P0)

**Nowy plik:** `forge-session/crash-recovery.js` (~120L)

```
writeLock(cwd, { taskId, waveN, startedAt, sessionInfo })
  → .forge/session/auto.lock (JSON)

clearLock(cwd)
  → rm .forge/session/auto.lock

readCrashLock(cwd) → lockData | null
  → sprawdź czy lock istnieje + czy PID jeszcze żyje

synthesizeRecovery(cwd, lockData) → recoveryBriefing
  → przeczytaj ledger state + git log --since=lockData.startedAt
  → wygeneruj briefing: co było robione, co się udało, co trzeba dokończyć
```

**Integracja:**
- execute-phase workflow: writeLock przed każdą wave, clearLock po
- resume-work workflow: readCrashLock → jeśli crash → synthesizeRecovery → inject do promptu
- doctor.js: nowy check — stale lock file warning

### 4.2 Auto Mode — State Machine (P1)

**Nowy moduł:** `forge-auto/` (~500L)

```
forge-auto/
├── auto.js          — main loop: read state → determine next → dispatch → repeat
├── state-machine.js — phase transitions: research → plan → execute → verify → complete
└── dispatcher.js    — fresh session dispatch via claude --print (reuse worktree-orchestrator pattern)
```

**State machine:**
```
START → READ_STATE → DETERMINE_NEXT_UNIT
  → RESEARCH_PHASE (jeśli brak research)
  → PLAN_PHASE (jeśli brak planów)
  → EXECUTE_TASK (jeśli task pending)
  → VERIFY_PHASE (jeśli all tasks done)
  → COMPLETE_PHASE (jeśli verified)
  → REASSESS_ROADMAP (jeśli phase complete)
  → NEXT_PHASE | MILESTONE_COMPLETE
```

**Kluczowe cechy (z GSD-2):**
- Fresh context per unit (claude --print z pre-inlined context)
- Disk-driven (czyta .forge/ + .planning/ — zero in-memory state)
- Crash-safe (writeLock per unit, clearLock po)
- Cost tracking (metrics.js per unit)
- Stuck detection (same unit dispatched 2x → retry once → stop)
- Escape (Ctrl+C → graceful pause → resume later)

**Integracja z istniejącym FDP:**
- Auto mode używa factory.js do budowania agent configs (grounding, conventions, decisions — już gotowe)
- Auto mode używa engine.js do weryfikacji (incremental, cache — już gotowe)
- Auto mode używa worktree-orchestrator do izolacji (already 80% of what's needed)
- Auto mode loguje do ledger (wave knowledge propagation — already works)

**Nowe komendy:**
- `/forge:auto` — uruchom auto mode
- `/forge:auto-stop` — zatrzymaj gracefully
- `/forge:auto-status` — dashboard postępu

### 4.3 Timeout Supervision (P1)

**Modyfikacja:** `forge-containers/orchestrator.js` + `worktree-orchestrator.js`

```javascript
// Existing: hard timeout via timeout_seconds config
// NEW: 3-tier supervision

const SOFT_TIMEOUT_RATIO = 0.7;   // 70% of hard timeout → warn agent
const IDLE_CHECK_INTERVAL = 60000; // check every 60s for git changes
const IDLE_MAX_SECONDS = 300;      // 5min without changes → kill

function startSupervision(task, hardTimeout) {
  // Soft timeout: inject context warning via AdditionalContext
  const softMs = hardTimeout * SOFT_TIMEOUT_RATIO * 1000;
  task.softTimer = setTimeout(() => injectTimeoutWarning(task), softMs);

  // Idle watchdog: check git diff periodically
  task.idleWatchdog = setInterval(() => {
    const lastChange = getLastGitChangeTime(task.worktree);
    if (Date.now() - lastChange > IDLE_MAX_SECONDS * 1000) {
      killTask(task, 'idle_timeout');
    }
  }, IDLE_CHECK_INTERVAL);

  // Hard timeout: existing behavior (kill after N seconds)
}
```

### 4.4 Cost/Token Tracking (P2)

**Nowy plik:** `forge-session/metrics.js` (~180L)

```javascript
// Schema: .forge/session/metrics.json
{
  "version": 1,
  "started_at": "2026-03-11T10:00:00Z",
  "budget_ceiling_usd": 50.00,
  "units": [
    {
      "type": "execute-task",
      "id": "phase-3/wave-1/agent-01",
      "model": "claude-sonnet-4-6",
      "started_at": 1741686000000,
      "finished_at": 1741686120000,
      "tokens": { "input": 45000, "output": 12000, "cache_read": 8000, "total": 65000 },
      "cost_usd": 0.42,
      "phase": "execution"
    }
  ]
}

// Functions:
initMetrics(cwd)
snapshotUnitMetrics(cwd, unitData)
getProjectTotals(cwd) → { total_cost, total_tokens, by_phase, by_model }
checkBudget(cwd) → { within_budget, remaining_usd, projected_total }
```

**Dashboard integration:** Nowa zakładka "Cost" w forge-graph/dashboard-generator.js.

### 4.5 Roadmap Reassessment (P3)

**Nowy workflow:** `atos-forge/workflows/reassess-roadmap.md`

Trigger: po execute-phase complete. Agent czyta:
- Co zostało zrobione (SUMMARY.md)
- Co się zmieniło vs plan (diff planowane vs wykonane)
- Czego się nauczył (ledger warnings/discoveries)

Decyduje:
- Czy roadmap jest nadal aktualny
- Czy trzeba dodać/usunąć/reorder fazy
- Automatycznie aktualizuje ROADMAP.md

### 4.6 Browser Tools — Verification Layer 9 (P4)

**Nowy plik:** `forge-verify/browser-layer.js` (~200L)

Opcjonalna warstwa 9 (BROWSER) w engine.js:
- Wymaga: playwright jako optional peer dependency
- Sprawdza: czy UI renderuje się poprawnie, czy routes działają, czy formularze submitują
- Trigger: jeśli plan modyfikuje pliki frontend (detected via graph capabilities: ui_components, react_advanced)
- Config: `verification.layers.browser: false` (domyślnie wyłączone)

---

## 5. Rozszerzenie Code Graph — z CGC

### 5.1 Function-Level Call Graph

**Modyfikacja:** `forge-graph/builder.js`

Obecny builder extrahuje imports (file→file). Nowy builder DODATKOWO extrahuje:
- Function calls (symbol→symbol) przez Tree-sitter AST traversal
- Class inheritance (extends/implements)
- Method calls na obiektach

**Nowe tabele (dodane do schema.sql):**

```sql
CREATE TABLE IF NOT EXISTS call_graph (
    caller_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    callee_name      TEXT NOT NULL,
    callee_file      TEXT,
    call_site_line   INTEGER,
    call_type        TEXT NOT NULL DEFAULT 'direct',
    resolved         BOOLEAN DEFAULT 0,
    PRIMARY KEY (caller_symbol_id, callee_name, call_site_line)
);

CREATE TABLE IF NOT EXISTS class_hierarchy (
    child_id    INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    parent_name TEXT NOT NULL,
    parent_file TEXT,
    relation    TEXT NOT NULL DEFAULT 'extends',
    resolved    BOOLEAN DEFAULT 0,
    PRIMARY KEY (child_id, parent_name)
);

CREATE TABLE IF NOT EXISTS dead_code (
    symbol_id   INTEGER PRIMARY KEY REFERENCES symbols(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL,
    confidence  REAL DEFAULT 0.0,
    detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_call_graph_caller ON call_graph(caller_symbol_id);
CREATE INDEX IF NOT EXISTS idx_call_graph_callee ON call_graph(callee_name);
CREATE INDEX IF NOT EXISTS idx_class_hierarchy_child ON class_hierarchy(child_id);
CREATE INDEX IF NOT EXISTS idx_class_hierarchy_parent ON class_hierarchy(parent_name);
```

### 5.2 Nowe Query Capabilities

**Modyfikacja:** `forge-graph/query.js`

```javascript
// Function-level impact (vs current file-level)
getCallersOf(symbolName, file?) → [{ caller, file, line }]
getCalleesOf(symbolName, file?) → [{ callee, file, line }]
getCallChain(symbolName, depth=3) → tree of calls

// Class hierarchy
getParentClasses(symbolName) → [{ parent, relation }]
getChildClasses(symbolName) → [{ child, relation }]
getFullHierarchy(symbolName) → tree

// Dead code
getDeadCode(module?) → [{ symbol, file, reason, confidence }]
getUnusedExports(module?) → [{ symbol, file, exported_but_never_imported }]

// Complexity (enhanced)
getComplexSymbols(threshold=10) → [{ symbol, file, complexity, loc }]
```

### 5.3 File Watcher

**Nowy plik:** `forge-graph/watcher.js` (~100L)

```javascript
const fs = require('fs');
const { updater } = require('./updater');

function watch(cwd, opts = {}) {
  const watcher = fs.watch(cwd, { recursive: true }, (event, filename) => {
    if (shouldIgnore(filename)) return;
    // Debounce 500ms
    clearTimeout(watcher._debounce);
    watcher._debounce = setTimeout(() => {
      updater.incrementalUpdate(cwd, [filename]);
    }, 500);
  });
  return watcher;
}
```

Config: `graph.auto_watch: false` (domyślnie wyłączone — opt-in).

### 5.4 Rozszerzone Dashboard

**Modyfikacja:** `forge-graph/dashboard-generator.js`

Nowe zakładki:
- **Call Graph** — D3 force graph z function-level calls (nie tylko module-level)
- **Dead Code** — lista nieużywanych symboli z confidence score
- **Cost** — token/cost breakdown per phase/model (z metrics.js)
- **Class Hierarchy** — tree view z inheritance

---

## 6. Decyzje architektoniczne

| Decyzja | Wybór | Rationale |
|---------|-------|-----------|
| Database | SQLite (better-sqlite3) | Zero config, single file, sync queries <1ms, air-gapped |
| Runtime | Node.js CJS | Ten sam runtime co Claude Code, zero Python dependency |
| Graph model | Relacyjny (SQL) + custom BFS/DFS | Prostsze niż Cypher, wystarczające dla import/call graphs |
| Parser | Tree-sitter (JS bindings) | Multi-language, AST-level accuracy |
| Agent isolation | Docker / git worktree | Full filesystem isolation, parallel execution |
| Session memory | Markdown ledger + SQLite decisions | Ledger for human readability, SQLite for queryability |
| Verification | 8-layer fail-fast | Independent layers, toggleable, auto-fix loop |
| Context injection | Pre-inline (3-level) | FULL/INTERFACE/SUMMARY — 40-60% token savings |
| Anti-hallucination | Fact-grounding from graph | Verified exports/signatures in prompt |
| Air-gapped | TAK (zero network calls) | Only Claude Code itself needs network |
| CGC integration | NIE (zostajemy z SQLite) | Avoids Python dep, preserves sync queries, custom tables |
| GSD-2 integration | Selective feature port | Auto mode, crash recovery, cost tracking, timeouts |

---

## 7. Roadmap rozwoju

### Faza natychmiastowa (P0-P1)
- [ ] Crash Recovery (forge-session/crash-recovery.js)
- [ ] Auto Mode state machine (forge-auto/)
- [ ] Timeout supervision (soft/idle/hard w orchestrators)

### Faza krótkoterminowa (P2)
- [ ] Cost/Token tracking (forge-session/metrics.js)
- [ ] Function-level call graph (call_graph table + builder + query)
- [ ] Dead code detection (dead_code table + query)
- [ ] Class hierarchy tracking (class_hierarchy table)

### Faza średnioterminowa (P3)
- [ ] Roadmap reassessment workflow
- [ ] File watcher (forge-graph/watcher.js)
- [ ] Dashboard: Call Graph + Dead Code + Cost tabs
- [ ] Rozszerzenie convention-detector o function-level patterns

### Faza długoterminowa (P4)
- [ ] Browser verification layer (Playwright, optional)
- [ ] Enhanced complexity analysis (cyclomatic per function)
- [ ] Skill discovery system (auto-detect domain → load skills)

---

## 8. Inwentarz plików

```
FDP Root
├── atos-forge/                    CLI entry point
│   ├── bin/forge-tools.cjs        709L thin dispatcher
│   ├── bin/lib/                   21 CJS modules
│   ├── workflows/                 32 workflow definitions
│   ├── templates/                 ~10 templates
│   └── references/                5 reference docs
├── forge-graph/                   Code Graph Engine
│   ├── builder.js, query.js       Core (3755L combined)
│   ├── schema.sql                 12 tables + 14 indexes
│   ├── convention-detector.js     Auto-detect conventions
│   ├── dashboard-generator.js     HTML D3.js dashboard
│   ├── updater.js, snapshot.js    Incremental + snapshots
│   └── watcher.js                 [PLANNED] Live file watching
├── forge-session/                 Session Memory
│   ├── ledger.js                  Markdown ledger
│   ├── decisions.js               SQLite decisions.db
│   ├── knowledge.js               Persistent learnings
│   ├── crash-recovery.js          [PLANNED] Lock + recovery
│   └── metrics.js                 [PLANNED] Cost/token tracking
├── forge-agents/                  Agent Orchestration
│   ├── factory.js                 1469L agent builder (grounding, conventions, compression)
│   ├── parallel-planner.js        DAG scheduling
│   └── agent-output-schema.js     Structured JSON output
├── forge-verify/                  Verification Pipeline
│   ├── engine.js                  1852L 8-layer + incremental
│   ├── loop.js                    Auto-fix + escalation
│   ├── contract-layer.js          Cross-repo contracts
│   ├── cache.js                   Content-addressed cache
│   ├── test-stub-generator.js     RED→GREEN stubs
│   └── browser-layer.js           [PLANNED] Playwright
├── forge-assess/                  Task Assessment
│   ├── assessor.js                Context overflow detection
│   └── splitter.js                4-strategy splitting (connected_component first)
├── forge-containers/              Execution Isolation
│   ├── orchestrator.js            Docker lifecycle
│   ├── worktree-orchestrator.js   Git worktree fallback
│   └── ...                        config, resource-mgr, specs, collectors
├── forge-system/                  Multi-Repo System Graph
│   └── ...                        builder, query, detect, validate, sync, dashboard
├── forge-config/                  Configuration
│   └── config.js, doctor.js, settings.js
├── forge-analyze/                 Impact Analyzer
│   └── analyzer.js
├── forge-auto/                    [PLANNED] Auto Mode
│   ├── auto.js                    Main loop
│   ├── state-machine.js           Phase transitions
│   └── dispatcher.js              Fresh session dispatch
├── commands/forge/                31 slash commands
├── agents/                        11 specialized agents
├── hooks/                         3 hooks (statusline, context-monitor, check-update)
├── tests/                         4 test files (101 total tests)
├── bin/install.js                 Installer
└── docs/                          USER-GUIDE, SYSTEM-GRAPH-ARCHITECTURE
```

**Totals:** ~50 JS/CJS modules | 31 commands | 32 workflows | 11 agents | 3 hooks | 101 tests
