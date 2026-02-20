# Atos Forge — Multi-Repo System Graph Architecture

## Status: Draft — Design Document
## Date: 2026-02-20

---

## 1. Problem Statement

Atos Forge currently operates on a single git repository. The code graph (`forge-graph/`) indexes files, symbols, dependencies, and modules within one repo. This works well for monoliths and single-service projects.

Modern systems consist of hundreds of repositories composing one product — microservices, shared libraries, frontend apps, infrastructure repos. In a 500-repo system:

- Claude cannot scan the entire codebase in one context window
- A change in one repo may break consumers in 10 other repos
- Impact analysis stops at repo boundaries
- Agent spawning (containers/worktrees) is limited to one repo
- There is no system-level risk visibility

**Goal:** Extend Atos Forge with a **system-level graph** that indexes cross-repo interfaces, enabling system-wide impact analysis, cross-repo agent spawning, and a hierarchical dashboard.

---

## 2. Architecture Overview

### Two-Layer Graph Model

```
┌─────────────────────────────────────────────────────┐
│                  SYSTEM GRAPH                        │
│            forge-system/system-graph.db              │
│                                                      │
│  service ──exports──▶ interface                      │
│  service ──imports──▶ interface                      │
│  service ──owns──▶ repo                              │
│  team ──maintains──▶ service                         │
│                                                      │
│  Nodes: services, interfaces, repos, teams           │
│  Edges: exports, imports, owns, maintains            │
│  Source: .forge/interfaces.yaml per repo             │
└──────────────┬──────────────────────────────────────┘
               │ drills down via repo reference
┌──────────────▼──────────────────────────────────────┐
│                  LOCAL GRAPH (per repo)               │
│            .forge/graph.db (existing)                 │
│                                                      │
│  file ──imports──▶ file                              │
│  file ──contains──▶ symbol                           │
│  file ──belongs_to──▶ module                         │
│                                                      │
│  Nodes: files, symbols, modules                      │
│  Edges: imports, contains, belongs_to                 │
│  Source: tree-sitter parsing (existing)               │
└─────────────────────────────────────────────────────┘
```

**Key principle:** The system graph is small (hundreds of services, thousands of interfaces). The local graphs are large (hundreds of files per repo). They reference each other but live separately. Claude queries are always focused — never loading the full graph into context.

### Module Layout

```
atos-forge/          (existing — CLI entry point)
forge-graph/         (existing — per-repo code graph)
forge-system/        (NEW — system-level graph)
  ├── schema.sql           — SQLite schema for system-graph.db
  ├── builder.js           — Build/rebuild system graph from interfaces.yaml files
  ├── query.js             — Query API (CLI + programmatic)
  ├── sync.js              — Sync one repo's interfaces.yaml into system graph
  ├── detect.js            — Auto-detect interfaces during forge:init
  ├── dashboard.js         — System-level dashboard generator
  └── validate.js          — Validate interfaces.yaml + cross-repo contract checks
```

---

## 3. Data Model

### 3.1 `interfaces.yaml` (per repo, in `.forge/`)

This is the bridge between local and system graphs. Created by `forge:init`, maintained by developers, versioned in git.

```yaml
# .forge/interfaces.yaml
service:
  name: payment-service
  repo: org/payment-service          # git remote identifier
  team: payments                      # owning team
  description: "Handles payment processing and billing"
  version: 2.3.0                      # service version (semver)

exports:
  # REST API endpoints
  - type: api
    protocol: rest
    spec: openapi.yaml                # path to spec file (optional)
    base_path: /api/payments
    endpoints:
      - method: POST
        path: /api/payments
        description: "Create a payment"
        request_schema: schemas/create-payment.json
        response_schema: schemas/payment.json
      - method: GET
        path: /api/payments/{id}
        description: "Get payment by ID"
        response_schema: schemas/payment.json

  # Async events published
  - type: event
    protocol: kafka                    # kafka | rabbitmq | redis-pubsub | sqs
    topic: payments.completed
    schema: schemas/payment-completed.avsc
    description: "Emitted when payment succeeds"

  # Shared package/library
  - type: package
    registry: npm                      # npm | pypi | maven | nuget
    name: "@org/payment-types"
    entry: dist/index.d.ts
    description: "TypeScript types for payment domain"

  # gRPC service
  - type: rpc
    protocol: grpc
    proto: proto/payment.proto
    service: PaymentService
    methods: [CreatePayment, GetPayment, RefundPayment]

  # Database (owned by this service)
  - type: database
    name: payments_db
    tables: [payments, refunds, invoices]
    description: "Payment service database — do not query directly"

imports:
  # APIs consumed
  - type: api
    service: user-service
    endpoints:
      - method: GET
        path: /api/users/{id}
    usage: "Fetch user details for payment receipts"

  # Events consumed
  - type: event
    service: order-service
    topic: orders.created
    usage: "Trigger payment processing when order is placed"

  # Packages consumed
  - type: package
    name: "@org/shared-types"
    version: "^2.0.0"

  # Database read (cross-service — should be flagged as coupling)
  - type: database
    service: user-service
    tables: [users]
    access: read-only
    usage: "Direct DB read — migration target: use user-service API instead"
    deprecated: true
```

### 3.2 System Graph SQLite Schema (`system-graph.db`)

```sql
-- Services (one per repo, or multiple if monorepo)
CREATE TABLE services (
  id TEXT PRIMARY KEY,                    -- e.g. "payment-service"
  repo TEXT NOT NULL,                     -- e.g. "org/payment-service"
  team TEXT,
  description TEXT,
  version TEXT,
  local_graph_path TEXT,                  -- path to repo's .forge/graph.db
  interfaces_hash TEXT,                   -- SHA of interfaces.yaml for staleness
  last_synced TEXT,                       -- ISO timestamp
  UNIQUE(repo)
);

-- Interfaces (exported capabilities)
CREATE TABLE interfaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL REFERENCES services(id),
  type TEXT NOT NULL,                     -- api | event | package | rpc | database
  protocol TEXT,                          -- rest | grpc | kafka | rabbitmq | npm | pypi
  name TEXT NOT NULL,                     -- endpoint path, topic name, package name
  description TEXT,
  spec_path TEXT,                         -- path to spec file within repo
  schema_path TEXT,                       -- path to schema file
  metadata TEXT,                          -- JSON blob for type-specific fields
  UNIQUE(service_id, type, name)
);

-- Dependencies (imports between services)
CREATE TABLE dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumer_id TEXT NOT NULL REFERENCES services(id),
  provider_id TEXT NOT NULL REFERENCES services(id),
  interface_id INTEGER REFERENCES interfaces(id),
  type TEXT NOT NULL,                     -- api | event | package | rpc | database
  usage TEXT,                             -- human description of why
  deprecated INTEGER DEFAULT 0,          -- flagged for removal
  UNIQUE(consumer_id, provider_id, interface_id)
);

-- Teams
CREATE TABLE teams (
  id TEXT PRIMARY KEY,                    -- e.g. "payments"
  services TEXT                           -- JSON array of service IDs
);

-- Sync log (track what's been imported)
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL REFERENCES services(id),
  synced_at TEXT NOT NULL,
  interfaces_hash TEXT NOT NULL,
  changes_summary TEXT                    -- what changed since last sync
);

-- Indexes
CREATE INDEX idx_deps_consumer ON dependencies(consumer_id);
CREATE INDEX idx_deps_provider ON dependencies(provider_id);
CREATE INDEX idx_interfaces_service ON interfaces(service_id);
CREATE INDEX idx_interfaces_type ON interfaces(type);
```

---

## 4. Interface Detection (`forge-system/detect.js`)

During `forge:init`, auto-detect interfaces to generate a draft `interfaces.yaml`:

### Detection Rules

| Signal | Interface Type | Detection Method |
|--------|---------------|-----------------|
| `openapi.yaml`, `swagger.json` | api (rest) | Parse spec, extract paths + methods |
| `*.proto` files | rpc (grpc) | Parse proto, extract services + methods |
| Kafka producer imports | event (kafka) | Grep for `producer.send`, `KafkaProducer`, topic strings |
| RabbitMQ publish calls | event (rabbitmq) | Grep for `channel.publish`, `basic_publish` |
| `package.json` with `main`/`exports` | package (npm) | Read package.json, extract public entry |
| `setup.py`/`pyproject.toml` with name | package (pypi) | Read Python package config |
| `docker-compose.yml` with ports | api (rest) | Extract service names + exposed ports |
| SQLAlchemy/Prisma models | database | Extract table names from ORM models |
| `.env` with `*_API_URL` vars | api (import) | Infer consumed services from env config |
| `requirements.txt`/`package.json` deps | package (import) | Extract org-scoped packages as imports |
| Fetch/axios calls to known paths | api (import) | Pattern match HTTP client calls |

### Generation Flow

```
forge:init
  ├── [existing] Build local code graph
  ├── [NEW] Run detect.js on codebase
  │   ├── Scan for spec files (openapi, proto, avro)
  │   ├── Scan for producer/publisher patterns
  │   ├── Scan for package exports
  │   ├── Scan for consumed services (env vars, HTTP clients)
  │   └── Scan for org-scoped package imports
  ├── [NEW] Generate .forge/interfaces.yaml (draft)
  ├── [NEW] Print summary: "Detected 3 exports, 5 imports — review .forge/interfaces.yaml"
  └── [existing] Create .forge/ environment
```

The generated file is a **draft** — clearly marked with comments like `# AUTO-DETECTED — verify and adjust`. The developer reviews, corrects, and commits it.

---

## 5. System Graph Build & Sync

### 5.1 Initial Build (`forge-system/builder.js`)

Build the full system graph from scratch by scanning all repos:

```bash
# From a "system" repo or any repo with access to all others
node forge-system/builder.js --repos repos.json --output system-graph.db
```

`repos.json` — registry of all repos in the system:

```json
{
  "repos": [
    { "name": "org/payment-service", "path": "/code/payment-service" },
    { "name": "org/user-service", "path": "/code/user-service" },
    { "name": "org/order-service", "path": "/code/order-service" }
  ]
}
```

Or auto-discover from a GitHub org:

```bash
node forge-system/builder.js --github-org myorg --output system-graph.db
```

Build pipeline:
1. For each repo, read `.forge/interfaces.yaml`
2. Insert service + interfaces into `services` and `interfaces` tables
3. Resolve imports → match against exports to create `dependencies` edges
4. Validate: warn on unresolved imports (service declares consuming an endpoint that no one exports)
5. Compute system-level metrics: fan-in (how many consumers), fan-out (how many dependencies), coupling score

### 5.2 Incremental Sync (`forge-system/sync.js`)

Update the system graph when a single repo's interfaces change:

```bash
# Run from within a repo after updating interfaces.yaml
node forge-system/sync.js --db /path/to/system-graph.db
```

1. Read local `.forge/interfaces.yaml`
2. Compute hash, compare with `sync_log`
3. If changed: delete old entries for this service, re-insert, re-resolve dependencies
4. Log sync to `sync_log` with changes summary

Can be triggered by:
- `forge:init` (initial registration)
- Git hook (post-commit on `interfaces.yaml`)
- CI pipeline step
- Manual `forge:system-sync` command

### 5.3 Validation (`forge-system/validate.js`)

```bash
node forge-system/validate.js --db system-graph.db
```

Checks:
- **Orphan imports:** Service A imports from service B, but service B doesn't export that interface
- **Version mismatches:** Package consumer pins `^2.0` but provider is at `3.1`
- **Deprecated dependencies:** Flag services still consuming deprecated interfaces
- **Circular service dependencies:** A → B → C → A
- **Schema compatibility:** If schema files are referenced, check backward compatibility (optional, future)
- **Direct DB access:** Flag any `type: database` imports (tight coupling anti-pattern)

---

## 6. Query API (`forge-system/query.js`)

### CLI Commands

```bash
# System overview — services, edges, health
node forge-system/query.js overview --db system-graph.db

# What does this service export?
node forge-system/query.js exports payment-service --db system-graph.db

# What does this service consume?
node forge-system/query.js imports payment-service --db system-graph.db

# Who consumes this service? (fan-in)
node forge-system/query.js consumers payment-service --db system-graph.db

# Full impact analysis — if I change this service, what breaks?
node forge-system/query.js impact payment-service --db system-graph.db
# Returns: direct consumers + transitive consumers (depth-limited)

# Impact analysis for a specific interface
node forge-system/query.js impact payment-service --interface "POST /api/payments" --db system-graph.db

# Cross-repo context for an agent working on a task
node forge-system/query.js context-for-task payment-service --files api/routes.py models/payment.py --db system-graph.db
# Returns: affected interfaces, consuming services, contract constraints

# System-level hotspots (most depended-on, highest coupling)
node forge-system/query.js hotspots --db system-graph.db

# Circular dependencies between services
node forge-system/query.js cycles --db system-graph.db

# Dependency path between two services
node forge-system/query.js path payment-service analytics-service --db system-graph.db

# Team impact — which teams need to coordinate for this change?
node forge-system/query.js team-impact payment-service --db system-graph.db
```

### Programmatic API

```javascript
const { SystemQuery } = require('forge-system/query');
const sq = new SystemQuery('/path/to/system-graph.db');
sq.open();

// Used by agent factory to build cross-repo context
const impact = sq.impact('payment-service', { depth: 2 });
// Returns: { service, direct_consumers: [...], transitive_consumers: [...],
//            affected_interfaces: [...], team_coordination: [...] }

// Used by parallel planner for cross-repo DAG
const deps = sq.serviceDependencies();
// Returns: { nodes: [...services], edges: [...dependencies] }

sq.close();
```

---

## 7. Integration with Existing Forge Modules

### 7.1 Agent Factory (`forge-agents/factory.js`)

**Current:** Builds agent context from local graph only.

**Extended:** If `system-graph.db` is available:

```javascript
// Step 1 (existing): Local graph context
const localContext = graph.getContextForTask(files);

// Step 2 (NEW): Cross-repo context
const systemContext = systemQuery.contextForTask(serviceName, files);
// Returns: { affected_interfaces, consuming_services, contract_constraints }

// Step 3: Compose agent prompt with both
agentConfig.system_prompt += `
## Cross-Repo Constraints
This service exports interfaces consumed by: ${systemContext.consuming_services.join(', ')}
Do NOT change these contracts without coordination:
${systemContext.contract_constraints.map(c => '- ' + c).join('\n')}
`;
```

### 7.2 Parallel Planner (`forge-agents/parallel-planner.js`)

**Current:** Plans waves within one repo based on file dependencies.

**Extended:** Plans waves across repos:

```
Wave 1: Modify API contract in payment-service (repo A)
Wave 2: Update client SDK in checkout-service (repo B) + analytics-service (repo C)
Wave 3: Integration test across all three
```

The DAG is built from `dependencies` table edges, not file-level imports.

### 7.3 Container Orchestrator (`forge-containers/`)

**Current:** Each container gets a worktree of the current repo.

**Extended:** Each container gets:
- Worktree of its target repo
- Read-only copy of system-graph.db
- Interface contracts from neighboring services (spec files)
- Local graph.db of its target repo

```javascript
// Container launch config for cross-repo work
{
  taskId: "update-checkout-client",
  repo: "org/checkout-service",
  agentConfig: { /* ... */ },
  context: {
    system_db: "/shared/system-graph.db",
    neighbor_specs: {
      "payment-service": "openapi.yaml"  // mounted read-only
    }
  }
}
```

### 7.4 Verification Engine (`forge-verify/`)

**New layer 7 — CONTRACT VERIFICATION:**

After modifying a service's exported interfaces, verify:
1. Does the updated `interfaces.yaml` match the actual code?
2. Are exported schemas backward-compatible?
3. Do consuming services' tests still pass against the new contract?

This is the cross-repo ripple verification:
```
verify locally → verify contracts → spawn verification agents in consumer repos
```

### 7.5 `forge:init` Extension

```
forge:init (extended)
  ├── [existing] Build local code graph
  ├── [existing] Create .forge/ environment
  ├── [NEW] Run interface detection
  ├── [NEW] Generate .forge/interfaces.yaml (draft)
  ├── [NEW] If system-graph.db path configured:
  │   ├── Sync this repo into system graph
  │   └── Show system-level context (consumers, providers)
  └── [existing] Generate dashboard
```

### 7.6 Dashboard

**System-level dashboard** (`forge-system/dashboard.js`):

- **Level 1 — System Map:** Force-directed graph of services as nodes, dependency edges between them. Color by team. Size by fan-in (more consumers = bigger node). Click to drill down.
- **Level 2 — Service Detail:** Panel showing exports, imports, consumers, version, team. Link to open repo's local dashboard.
- **Level 3 — Per-repo dashboard:** Existing `forge-graph/dashboard-generator.js` output.

Same static HTML approach — system-graph.db is small enough to inline as JSON. Generated by:

```bash
node forge-system/dashboard.js --db system-graph.db --output system-dashboard.html
```

Uses the same EUROCONTROL theme (Exo font, navy header, light background).

Tabs:
1. **Service Map** — force-directed graph (services as nodes)
2. **Dependency Matrix** — NxN grid, cell = dependency exists (similar to capability matrix)
3. **Interface Registry** — searchable table of all exported interfaces across system
4. **Risk Register** — system-level: highest fan-in, most deprecated deps, circular deps
5. **Team View** — group services by team, show cross-team dependencies

---

## 8. Configuration

### System-level config (in system repo or `~/.forge/system-config.json`)

```json
{
  "system": {
    "name": "EUROCONTROL Platform",
    "repos_source": "github-org",
    "github_org": "eurocontrol",
    "system_graph_path": ".forge/system-graph.db",
    "auto_sync": true,
    "sync_on_commit": true
  },
  "repos_registry": "repos.json",
  "validation": {
    "warn_deprecated": true,
    "fail_on_orphan_imports": false,
    "fail_on_circular_deps": true,
    "schema_compat_check": false
  }
}
```

### Per-repo config addition (`.forge/config.json`)

```json
{
  "system": {
    "graph_path": "/shared/system-graph.db",
    "service_name": "payment-service"
  }
}
```

---

## 9. CLI Commands Summary

### New `forge-tools.cjs` commands

```
forge:system-init                    — Initialize system graph from repos registry
forge:system-sync                    — Sync current repo into system graph
forge:system-status                  — Show system graph health + stats
forge:system-impact <service>        — Cross-repo impact analysis
forge:system-validate                — Check all contracts and flag issues
forge:system-dashboard               — Generate system-level dashboard
```

### New `forge-system/` CLI

```
node forge-system/builder.js --repos <file> --output <db>     — Full build
node forge-system/builder.js --github-org <org> --output <db>  — Build from GitHub org
node forge-system/sync.js --db <db>                            — Sync current repo
node forge-system/query.js <command> --db <db>                 — Query system graph
node forge-system/validate.js --db <db>                        — Validate contracts
node forge-system/dashboard.js --db <db> --output <html>       — Generate dashboard
node forge-system/detect.js [--root .]                         — Detect interfaces in current repo
```

---

## 10. Implementation Plan

### Phase 1: Foundation — interfaces.yaml + detect (3 files)

**Files:** `forge-system/detect.js`, `forge-system/schema.sql`, `forge-system/validate.js`

1. Define `interfaces.yaml` schema (the spec above)
2. Implement `detect.js` — auto-detect interfaces from codebase signals
3. Integrate into `forge:init` — generate draft `interfaces.yaml`
4. Implement basic `validate.js` — schema validation of interfaces.yaml
5. No system graph yet — this phase just gets repos declaring their interfaces

**Verification:** Run `forge:init` on L1 project → should detect REST API exports (FastAPI routes), Celery task events, Redis pub/sub, PostgreSQL tables.

### Phase 2: System Graph Core — build + query (3 files)

**Files:** `forge-system/builder.js`, `forge-system/query.js`, `forge-system/sync.js`

1. Create SQLite schema (`schema.sql`)
2. Implement `builder.js` — scan repos, read interfaces.yaml, build graph
3. Implement `query.js` — overview, exports, imports, consumers, impact, hotspots, cycles, path
4. Implement `sync.js` — incremental update from one repo
5. Test with 2-3 repos (L1 app, HEXAI platform, a mock service)

**Verification:** Build system graph from L1 + HEXAI → `query.js impact l1-service-desk` returns HEXAI as consumer (if it consumes anything from L1, or vice versa).

### Phase 3: Agent Integration — cross-repo context (modify 3 existing files)

**Files:** Modify `forge-agents/factory.js`, `forge-agents/parallel-planner.js`, `forge-containers/orchestrator.js`

1. Extend agent factory to pull cross-repo context from system graph
2. Extend parallel planner to build cross-repo DAGs
3. Extend container orchestrator to mount system-graph.db + neighbor specs
4. Add contract constraints to agent prompts

**Verification:** Agent spawned for L1 API change receives context about consuming services.

### Phase 4: System Dashboard (1 new file)

**Files:** `forge-system/dashboard.js`

1. Implement system-level dashboard generator (same pattern as forge-graph/dashboard-generator.js)
2. Service Map tab (force-directed, D3)
3. Dependency Matrix tab
4. Interface Registry tab
5. Risk Register tab (system-level hotspots)
6. EUROCONTROL theme (reuse existing CSS generator or extract shared theme)

**Verification:** Generate system dashboard for L1 + HEXAI → shows two services with dependency edges.

### Phase 5: Verification Extension — contract checks (modify 1 existing file, 1 new)

**Files:** Modify `forge-verify/engine.js`, new `forge-verify/contract-layer.js`

1. Add Layer 7 (CONTRACT) to verification engine
2. Check: does code match declared interfaces?
3. Check: are schemas backward-compatible after changes?
4. Cross-repo ripple verification: spawn verification agents in consumer repos

**Verification:** Modify an API route in L1 → verification flags "this endpoint is exported in interfaces.yaml, 2 consumers depend on it."

### Phase 6: CLI + forge-tools integration (modify 1 existing file)

**Files:** Modify `atos-forge/bin/forge-tools.cjs`

1. Add `system-init`, `system-sync`, `system-status`, `system-impact`, `system-validate`, `system-dashboard` commands
2. Integrate system graph path into unified config
3. Add system checks to `forge:doctor`

**Verification:** `forge-tools.cjs system-status` shows system graph health.

---

## 11. Scaling Considerations

| Dimension | Expected Scale | Approach |
|-----------|---------------|----------|
| Repos | 500+ | SQLite handles thousands of rows trivially |
| Services | 500-1000 (some repos = multiple services) | Service table with repo FK |
| Interfaces | 5-20 per service → 5,000-10,000 | Indexed by service_id and type |
| Dependencies | ~3x interfaces → 15,000-30,000 | Indexed by consumer/provider |
| Dashboard data | ~500 nodes, ~5,000 edges | Static HTML with inlined JSON works |
| Build time | Full: seconds. Sync: milliseconds. | SQLite writes are fast |
| Claude context | Query results only, not raw DB | Focused responses, ~200-500 tokens per query |

SQLite is the right choice at this scale. Migration to Neo4j only if:
- Need real-time multi-user concurrent writes
- Traversal queries exceed SQLite's recursive CTE performance (unlikely at 500 services)
- Need graph-native algorithms (PageRank, community detection) for large-scale analysis

---

## 12. Open Questions

1. **Monorepo support:** A single repo may contain multiple services (e.g., monorepo with `packages/`). Should `interfaces.yaml` support declaring multiple services per repo?

2. **Versioned interfaces:** Should the system graph track interface versions over time (breaking change history) or just current state?

3. **Schema compatibility checking:** Deep schema validation (e.g., Avro backward compat, OpenAPI breaking change detection) is valuable but complex. Defer to Phase 5 or skip?

4. **CI integration:** Should `forge:system-sync` be a recommended CI step (run on merge to main) or manual?

5. **Access patterns:** Is the system-graph.db stored in a dedicated "system" repo, a shared filesystem, or each developer's machine with periodic sync?

---

## 13. File Tree After Implementation

```
forge-system/               (NEW MODULE)
  ├── schema.sql             — SQLite schema
  ├── detect.js              — Auto-detect interfaces from codebase
  ├── builder.js             — Full system graph build
  ├── sync.js                — Incremental sync from one repo
  ├── query.js               — CLI + programmatic query API
  ├── validate.js            — Contract validation
  ├── dashboard.js           — System dashboard generator
  └── package.json           — Module dependencies

Modified existing files:
  ├── atos-forge/bin/forge-tools.cjs    — New system-* commands
  ├── forge-agents/factory.js           — Cross-repo context in agents
  ├── forge-agents/parallel-planner.js  — Cross-repo DAG planning
  ├── forge-containers/orchestrator.js  — Mount system context in containers
  ├── forge-verify/engine.js            — Layer 7 contract verification
  └── forge-config/config.js            — system section in config schema

New per-repo file:
  └── .forge/interfaces.yaml            — Declared service interfaces
```
