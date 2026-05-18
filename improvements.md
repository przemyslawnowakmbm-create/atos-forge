# Forge — Improvements Plan

> **Scope:** Hardening, performance, quality, enterprise readiness, and ecosystem reach.
> **Non-goal:** Changing what Forge *is*. The SDLC loop (research → discuss → plan → execute → verify → commit → audit) and every `/forge-*` command must continue to work as today. Every change below is additive or backwards-compatible behind a config flag.

---

## 1. Executive Summary

Forge today is a strong **single-developer, single-machine** AI SDLC engine: code graph, 16-layer verification, ephemeral container/worktree execution, session ledger, dynamic agent factory. The deep-dive of the codebase plus the two reference inputs (Google's `skills` model and the OpenHands / "AI team of 131 specialists" article) surface five strategic deltas that block enterprise adoption and ecosystem reach:

| # | Theme | One-line problem | One-line fix |
|---|---|---|---|
| 1 | **Sandbox & secrets** | All agents inherit full `process.env` + run with `--dangerously-skip-permissions` + containers have unrestricted network | Env allowlist + capability-scoped agents + egress proxy + secrets manager adapter |
| 2 | **Audit & identity** | Ledger is human-readable Markdown; no identity, no append-only audit trail, no RBAC | Add signed append-only `audit.jsonl` + project identity + optional RBAC adapter |
| 3 | **Ecosystem reach** | Forge is Claude-Code-coupled; can't be consumed by Codex, OpenHands, Cursor, Gemini | Add `AGENTS.md` generator + `forge-mcp` server exposing graph/verify/plan |
| 4 | **Marketplace** | 21 hardcoded agent personas; no install path for new specialists | `/forge-add-agents <pack>` + `forge-skills/` adapter that wraps VoltAgent / Google `skills` packs |
| 5 | **Observability & supply chain** | No OTEL, no SBOM, no signed releases, ~90% of modules untested | OTEL exporter + `npm sbom` + cosign release + raise test floor to forge-graph / forge-verify / forge-containers |

Total effort: **8 phases**, each ships independently, all gated behind config flags. No existing slash command, file layout, or ledger format breaks.

---

## 2. Inputs Behind This Plan

### 2.1 Deep-dive (concrete file:line evidence)

- `forge-agents/provider.js:164,193` — `env: { ...process.env, ... }` passed to every agent and into Docker containers (full secret leakage).
- `forge-agents/provider.js:181` and `forge-containers/agent-entrypoint.js:252` — `--dangerously-skip-permissions` unconditionally.
- `forge-graph/updater.js:139,690` — `execSync` with unsanitized `--since` CLI argument (shell injection).
- `forge-containers/orchestrator.js:131,196,395` — unquoted task IDs / branch / container IDs interpolated into shell strings.
- `forge-containers/container-spec.js:163-197` — Docker invocation missing `--cap-drop ALL`, `--network`, `--read-only`, `--security-opt no-new-privileges`, `--pids-limit`, seccomp.
- `forge-session/knowledge.js`, `forge-session/ledger.js` — plaintext, never-purged knowledge base; learnings re-injected into every future agent prompt.
- `forge-assess/assessor.js:12,81-83` — universal `CHARS_PER_TOKEN = 4` heuristic + sync `fs.statSync` per file in hot path.
- `forge-session/metrics.js:13-20` — read-modify-write of `metrics.json` per unit completion; no batching.
- 7 test files / ~2300 LOC out of ~10 modules → > 90% of code (graph, containers, verify, assess, session, agents) has no test coverage.
- No `tsc`, no `@ts-check`, no `zod`, no `pino`, no OpenTelemetry, no Vault/SM client, no `npm sbom`, no cosign signature, no SSO/OIDC.

### 2.2 Google `skills` model (what's worth borrowing)

- Skills are **markdown-only, self-contained, opt-in** units installed via `npx skills add <pack>`.
- Each skill is a directory with a `SKILL.md` + supporting assets.
- Installation is **additive and reversible**; no runtime dependency.
- Lesson for Forge: agent personas (the current 21-agent catalog) should follow the same shape — markdown + frontmatter, installable in packs, never required to be present.

### 2.3 OpenHands / Noisy article (what's worth borrowing)

- **AGENTS.md as cross-runtime contract** — repos write onboarding docs *for AI workers*, not humans. OpenHands, Codex, Cursor, Gemini, Claude Code all read it.
- **Action-observation loop is explicit** — every step logs `action → observation → action`. This is replayable and debuggable.
- **Multi-agent delegation is multi-vendor** — OpenHands, VoltAgent's 131 subagents, Anthropic agents and Google skills coexist via marketplaces.
- **MCP servers (14,000+)** are the standard surface for tool exposure across IDEs and runtimes.

Lessons for Forge:
- Forge should *emit* `AGENTS.md` so any runtime can drive it.
- Forge should *expose* graph, verify, plan, and impact via an MCP server so external agents can consume Forge intelligence.
- Forge's agent loop should write an explicit `actions.jsonl` per wave for replay (the OpenHands "should_step" model).
- Forge should install 3rd-party subagent packs the way Google `skills` installs skill packs.

---

## 3. Non-Negotiable Compatibility Contract

Before listing changes, the contract every phase below must respect:

1. Every existing `/forge-*` slash command continues to work with no flag changes.
2. `.forge/` directory layout: existing paths (`session/ledger.md`, `knowledge/learnings.json`, `config.json`, `system-graph.db`, `code-graph.db`, `agents/`, `dashboard/`) keep their meaning. New artifacts go in new subdirectories (`audit/`, `actions/`, `secrets/`, `attestations/`).
3. Ledger Markdown format and `proper-lockfile` semantics are preserved. The new `audit.jsonl` is **additive**, not a replacement.
4. Existing plan frontmatter schema (`requirements:`, `must_haves:`, `verify:`) is preserved. New fields (`capabilities:`, `secrets_scope:`, `actions_log:`) are optional.
5. Graph schema migrations follow `forge-graph/schema.sql` versioning. Reads of v1 graphs from v2 readers must succeed.
6. All new behavior gated by `.forge/config.json` keys with safe defaults (off in v1, on by v3 once stable).
7. No Node major bump beyond the current `>=16.7.0` minimum. (Encryption uses Node `crypto`; OTEL uses optional dependency loaded only if installed.)
8. The agent directives in `CLAUDE.md` (THE SENIOR DEV OVERRIDE, FORCED VERIFICATION, EDIT INTEGRITY) remain the executor contract. New directives are additions, not replacements.

---

## 4. Improvement Areas

Each area lists: **why it matters**, **concrete change**, **target files**, **config flag**, **back-compat note**.

### 4.1 Sandbox Hardening (security)

#### 4.1.1 Environment allowlist for agent subprocesses

- **Why:** `provider.js:164,193` and `agent-entrypoint.js` pipe the entire developer shell environment into every agent and into every Docker container. One prompt-injection or one rogue MCP server = total secret exfiltration.
- **Change:** Replace `env: { ...process.env, ... }` with `env: scopeEnvForAgent(process.env, plan.secrets_scope)`. The scoper reads:
  - A default-deny allowlist (PATH, HOME, USER, LANG, TERM, NODE_OPTIONS limited).
  - The plan's `secrets_scope: []` frontmatter declaring which named secrets the agent legitimately needs.
  - Project policy at `.forge/policy/secrets.allowlist.yaml`.
- **Target files:**
  - `forge-agents/provider.js` — new `scope-env.js` utility.
  - `forge-containers/orchestrator.js` — same scoper before `--env` flag construction.
  - `forge-containers/container-spec.js:163` — extend `toDockerArgs` to take an `envScope` arg.
  - `forge-cli/templates/plan.md` — document `secrets_scope:` frontmatter.
- **Config flag:** `security.env_allowlist.enabled` (default `false` in v1, `true` in v3).
- **Back-compat:** When flag is off, behavior is identical to today. When on, plans without `secrets_scope` get the default-deny set and Forge prints a one-line warning.

#### 4.1.2 Container syscall / network / capability lockdown

- **Why:** `container-spec.js:163-197` is missing every Docker hardening flag.
- **Change:** Extend `toDockerArgs(spec)` to emit:
  ```
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE
  --security-opt no-new-privileges
  --security-opt seccomp=forge-containers/profiles/default.seccomp.json
  --pids-limit 512
  --read-only --tmpfs /tmp:rw,size=512m
  --network forge-egress     # see 4.1.3
  ```
  Add a `containers.profile: minimal | build | net` config knob — `minimal` is the default; `build` adds tooling capabilities; `net` (research agents that need package installs) enables a proxy.
- **Target files:**
  - `forge-containers/container-spec.js` — extend args.
  - `forge-containers/profiles/default.seccomp.json` — new file (whitelist of safe syscalls).
  - `forge-containers/orchestrator.js:105` — `docker build` command audited for unquoted strings (see 4.1.4).
- **Config flag:** `containers.hardened` (default `false` in v1, `true` in v2).
- **Back-compat:** Off by default. Setting it can break custom Dockerfiles; an opt-out per-plan via `container: { hardened: false }` frontmatter is provided.

#### 4.1.3 Egress proxy / DNS sinkhole

- **Why:** A compromised agent with network access can exfiltrate secrets or pull malware.
- **Change:** Ship a single-purpose egress proxy as `forge-containers/egress-proxy/` (tiny Node HTTP/SOCKS proxy bound to a Docker user-defined bridge `forge-egress`). It allowlists destinations from `.forge/policy/egress.allowlist.yaml` (e.g. `api.anthropic.com`, `registry.npmjs.org`, `*.github.com`). Default-deny.
- **Target files:**
  - `forge-containers/egress-proxy/proxy.js`
  - `forge-containers/egress-proxy/profiles/{strict,build,research}.yaml`
- **Config flag:** `containers.egress.mode = off | allowlist | passthrough`.
- **Back-compat:** Default `passthrough` (today's behavior).

#### 4.1.4 Eliminate shell-string command construction

- **Why:** `updater.js:139,690`, `orchestrator.js:131,196,395`, `provider.js:82` use template strings inside `execSync`. CLI arg `--since` is exploitable today.
- **Change:** Replace every `execSync(\`...\`)` with `execFileSync(cmd, [args])` (array form bypasses the shell). Use a small helper `forge-cli/lib/exec.js` so the pattern is consistent. Validate CLI inputs with a 30-line argv parser that rejects unknown flags and quotes nothing into the shell.
- **Target files:** `forge-graph/updater.js`, `forge-containers/orchestrator.js`, `forge-containers/worktree-orchestrator.js`, `forge-agents/provider.js`, anywhere `git ` or `docker ` is concatenated. Audit script: `scripts/audit-shell-strings.sh` (greps for the anti-pattern in CI).
- **Config flag:** None — pure code fix.
- **Back-compat:** Identical observable behavior; only the call mechanism changes.

#### 4.1.5 Sensitive-data redaction in ledger and knowledge base

- **Why:** `forge-session/knowledge.js` is "never purged across milestones" by design. If an agent ever processes a credential, it sticks forever and re-enters future prompts.
- **Change:** Add a redaction pass before any write to `ledger.md` or `learnings.json`:
  - Patterns: AWS keys, JWTs, `sk-*`, PEM blocks, DB DSNs (reuse `hooks/dist/forge-guard.js` patterns; lift them to `forge-session/redactor.js`).
  - Replace matches with `«REDACTED:<sha256-prefix>»` so collisions are detectable but the secret is gone.
  - Add a `forge-tools.cjs knowledge scrub` admin command.
- **Target files:** `forge-session/redactor.js`, `forge-session/ledger.js`, `forge-session/knowledge.js`, `hooks/dist/forge-guard.js` (refactor to share patterns).
- **Config flag:** `session.redaction.enabled` (default `true` immediately — this is safe).
- **Back-compat:** No format change; only previously-plaintext-leaked content is replaced inline.

#### 4.1.6 Optional encryption-at-rest

- **Why:** Even with redaction, ledger and knowledge files may contain proprietary architecture details. Enterprise customers want disk-level encryption controls they can audit.
- **Change:** Add `forge-session/vault.js` that, when enabled, AES-256-GCM-encrypts `learnings.json` and `ledger.md` using a key from one of:
  - macOS Keychain / Linux Secret Service
  - HashiCorp Vault (`VAULT_ADDR` + token)
  - AWS Secrets Manager / GCP Secret Manager / Azure Key Vault
  - `FORGE_VAULT_KEY` env (escape hatch)
- **Target files:** `forge-session/vault.js`, `forge-session/vault-adapters/{keychain,vault,aws,gcp,azure,env}.js`.
- **Config flag:** `session.encryption.adapter` (default `none`).
- **Back-compat:** Opt-in. Files remain plaintext until a customer turns it on, then in-place migration runs once.

---

### 4.2 Audit, Identity, RBAC (enterprise)

#### 4.2.1 Append-only signed audit log

- **Why:** Ledger is Markdown; not machine-queryable, not tamper-evident. SOC2 CC7 / ISO27001 A.12.4 require this.
- **Change:** Every state transition (phase start/complete, plan accept, agent dispatch, verification result, commit) writes one JSON line to `.forge/audit/audit.jsonl`. Each line carries:
  ```json
  {"ts":"...","actor":"...","action":"phase.execute","subject":"phase/72/PLAN.md","prev_hash":"...","hash":"...","sig":"..."}
  ```
  Hash chain = `sha256(prev_hash + canonical_json(record))`. Optional Ed25519 signature using the project identity key (4.2.2). Verifier CLI: `forge-tools.cjs audit verify`.
- **Target files:** `forge-session/audit.js`, `forge-cli/bin/forge-tools.cjs` (new `audit` subcommand: `tail | verify | export`).
- **Config flag:** `audit.enabled` (default `true` — append-only writes are cheap and additive).
- **Back-compat:** New file; does not replace `ledger.md`. Both coexist.

#### 4.2.2 Project identity (no auth server required)

- **Why:** Audit log needs an "actor." Today there is none — no SSO, no OIDC, no user record.
- **Change:** On `/forge-init`, generate an Ed25519 keypair under `.forge/identity/` (private key 0600-mode, public in repo-committable `identity.pub`). `git config user.email` becomes the human-readable actor; the keypair signs audit entries and `learnings.json` snapshots. For enterprise SSO, an adapter `forge-session/identity-adapters/oidc.js` accepts an OIDC ID token from a CI-injected env var (`FORGE_OIDC_TOKEN`) and uses its `sub` as actor.
- **Target files:** `forge-session/identity.js`, `forge-session/identity-adapters/{local,oidc,saml}.js`.
- **Config flag:** `identity.adapter` (default `local`).
- **Back-compat:** Pure addition; if disabled, audit entries record `actor: "anonymous"`.

#### 4.2.3 Capability-scoped agent permissions (RBAC-lite)

- **Why:** Every agent today runs with `--dangerously-skip-permissions`. There is no way to say "the docs agent can only touch `docs/`, never `src/`."
- **Change:** Each plan / agent declares `capabilities: [read_src, write_docs, run_tests, network_npm]`. The factory translates capabilities into:
  - Claude Code `--allowedTools` and `--disallowedTools` flags (replacing blanket `--dangerously-skip-permissions` where possible).
  - Container env scope (4.1.1).
  - Egress profile selection (4.1.3).
  - A pre-flight policy check that rejects writes outside declared paths.
- **Target files:** `forge-agents/factory.js` (~line 549 where prompt is composed), `forge-agents/capabilities.js` (new), `forge-cli/references/capabilities.md` (canonical capability list).
- **Config flag:** `security.capabilities.enforce` (default `warn` in v1, `enforce` in v3).
- **Back-compat:** When mode is `warn`, agents still run with today's permissions but a warning is logged for every capability violation. `enforce` requires plans to declare capabilities.

---

### 4.3 Performance

#### 4.3.1 Replace `chars/4` token heuristic

- **Why:** `assessor.js:12` is the single biggest source of plan-split miscalibration. For code-heavy files actual ratio is closer to 3.2–3.8.
- **Change:** Add `forge-assess/tokenizers/` with:
  - Cheap heuristic (default, unchanged for compatibility).
  - `@anthropic-ai/tokenizer` adapter loaded lazily (optional dependency).
  - `tiktoken` adapter for OpenAI/Codex flows.
  - Auto-select based on `forge-agents/provider.js` detected runtime.
- **Target files:** `forge-assess/assessor.js`, `forge-assess/tokenizers/{heuristic,anthropic,tiktoken}.js`.
- **Config flag:** `assess.tokenizer = heuristic | anthropic | tiktoken | auto`.
- **Back-compat:** `heuristic` is unchanged default.

#### 4.3.2 Async hot-path I/O

- **Why:** `assessor.js:81-83` (`statSync` per file), `metrics.js:13-20` (sync read-modify-write per unit) bottleneck large repos and 10+ agent waves.
- **Change:**
  - Convert assessor file walks to `fsp.stat` + `Promise.all`.
  - Add `forge-session/metrics-batcher.js` that buffers metric snapshots, flushes every 250ms or on shutdown.
- **Target files:** `forge-assess/assessor.js`, `forge-session/metrics.js`, `forge-session/metrics-batcher.js`.
- **Config flag:** None — internal change.
- **Back-compat:** Same on-disk format; just faster.

#### 4.3.3 SQLite tuning

- **Why:** `query.js:112` enables WAL but never sets `cache_size` or `mmap_size`. Default 2 MB cache hurts large repos.
- **Change:** On open, set:
  ```
  PRAGMA cache_size = -64000;  -- 64 MB
  PRAGMA mmap_size  = 268435456; -- 256 MB
  PRAGMA temp_store = MEMORY;
  PRAGMA synchronous = NORMAL;
  ```
- **Target files:** `forge-graph/query.js`, `forge-system/query.js`.
- **Config flag:** None.
- **Back-compat:** None affected.

#### 4.3.4 Verification cache + incremental graph updates

- **Why:** Re-running `/forge-verify-work` re-computes layers for unchanged files. `forge-verify/cache.js` exists but is under-used.
- **Change:**
  - Key cache by `(file_hash, layer_id, config_hash)`.
  - Layer 6 (tests) memoizes by content-addressed test bundle hash.
  - `forge-graph/updater.js` already supports `--since`; add `forge-graph/incremental.js` that batches by minute-level windows when called repeatedly in CI.
- **Target files:** `forge-verify/cache.js`, `forge-graph/incremental.js`.
- **Config flag:** `verify.cache.enabled` (default `true`).
- **Back-compat:** Cache is purely a speed-up; falls back to full verify on miss.

---

### 4.4 Quality, Observability, Supply Chain

#### 4.4.1 Test floor

- **Why:** > 90% of core code (graph, containers, verify, assess, session) has no tests. The deep-dive counted 7 test files.
- **Change:** Bring three modules to ≥ 60% statement coverage:
  - `forge-graph/` — builder, query, updater, capability detector.
  - `forge-verify/` — engine, loop, each layer's `verify()` entry point with table-driven fixtures.
  - `forge-containers/` — container-spec arg builder, worktree-orchestrator, patch-collector.
  Add `c8` (or built-in `--experimental-test-coverage`) and a CI gate.
- **Target files:** `tests/forge-graph/*.test.cjs`, `tests/forge-verify/*.test.cjs`, `tests/forge-containers/*.test.cjs`.
- **Config flag:** None.
- **Back-compat:** None affected.

#### 4.4.2 Type-check JS with `// @ts-check`

- **Why:** Zero TypeScript today, zero JSDoc on core modules. The CLAUDE.md FORCED VERIFICATION directive explicitly demands `npx tsc --noEmit` and there is nothing to run.
- **Change:** Add `tsconfig.check.json` with `allowJs`, `checkJs`, `noEmit`, `strict: false`. Add `// @ts-check` headers to factory, parallel-planner, orchestrator, engine.js. Add `npm run typecheck` to CI.
- **Target files:** `tsconfig.check.json`, top of `forge-agents/factory.js`, `forge-agents/parallel-planner.js`, `forge-containers/orchestrator.js`, `forge-verify/engine.js`.
- **Config flag:** None.
- **Back-compat:** None.

#### 4.4.3 Structured logging with redaction

- **Why:** All output is `console.log`/`console.error`. No level filtering, no JSON mode, no PII filter.
- **Change:** Lightweight in-repo logger `forge-cli/lib/logger.js` (no new dependency). Levels: `debug | info | warn | error`. JSON mode controlled by `FORGE_LOG_JSON=1`. Uses the redactor (4.1.5) on every payload.
- **Target files:** `forge-cli/lib/logger.js`, replace top-level `console.*` in factory, engine, orchestrator, provider.
- **Config flag:** `log.level = info`, `log.json = false`.
- **Back-compat:** Default `info` text mode is visually identical to today.

#### 4.4.4 OpenTelemetry exporter (optional)

- **Why:** Enterprise observability stacks (Datadog, Honeycomb, Tempo) consume OTLP. Forge has nothing.
- **Change:** Add `forge-session/otel.js` that lazy-imports `@opentelemetry/api` + `@opentelemetry/exporter-trace-otlp-http` if present. Emit spans for: phase start/end, wave dispatch, per-agent action, each verification layer. Span attributes include capability list, model, file count, redacted token counts (never raw content).
- **Target files:** `forge-session/otel.js`, instrumentation hooks in `forge-agents/parallel-planner.js`, `forge-verify/engine.js`.
- **Config flag:** `telemetry.otel.endpoint` (default empty = disabled).
- **Back-compat:** Disabled unless endpoint is set; OTEL packages are optional deps.

#### 4.4.5 SBOM + signed releases

- **Why:** Enterprise procurement requires SLSA-level provenance. Today `package.json` has `^` ranges and no signature.
- **Change:**
  - Add `npm sbom --sbom-format cyclonedx` step to the release script; commit `sbom.json` per tag under `.github/releases/`.
  - GitHub Actions release workflow signs the npm tarball with `cosign sign-blob` (Sigstore keyless OIDC).
  - `bin/install.js` verifies tarball signature when `--verify` is passed.
- **Target files:** `.github/workflows/release.yml`, `scripts/release.sh`, `bin/install.js` (verify flag).
- **Config flag:** None.
- **Back-compat:** Existing installs unaffected.

#### 4.4.6 Action-observation log (the OpenHands loop, made explicit)

- **Why:** Today's ledger captures decisions, not every step. Replay/debug of a wave requires guessing.
- **Change:** Each agent writes `.forge/actions/<phase>/<wave>/<agent>.jsonl` with one record per action:
  ```json
  {"ts":"...","action":"edit","path":"src/foo.ts","sha_before":"...","sha_after":"...","duration_ms":42}
  {"ts":"...","observation":"test","exit":0,"duration_ms":1130}
  ```
  Replayable with `forge-tools.cjs actions replay <path>`.
- **Target files:** `forge-session/actions.js`, hooks in `forge-containers/agent-entrypoint.js`, `forge-agents/provider.js`.
- **Config flag:** `actions.log.enabled` (default `true` — small footprint).
- **Back-compat:** New directory; ledger unchanged.

---

### 4.5 Ecosystem Reach — The Strategic Wins

#### 4.5.1 `AGENTS.md` generator (multi-runtime onboarding)

- **Why:** The Noisy article identifies `AGENTS.md` as the cross-runtime contract that OpenHands, Codex, Cursor, Gemini, Claude Code all read. Forge today ships `CLAUDE.md` (single runtime).
- **Change:** New command `/forge-agents-md` (and step inside `/forge-init`) generates an `AGENTS.md` at the project root from:
  - Code graph capabilities (`forge-graph capabilities`).
  - Detected build commands (`package.json` scripts, `Makefile` targets).
  - Forge's directives subset (verification rules, ledger awareness).
  - Plan / phase conventions.
  `CLAUDE.md` is preserved and continues to be the Forge-internal contract; `AGENTS.md` is the externalized, runtime-neutral form that delegates to `CLAUDE.md` when run inside Claude Code.
- **Target files:** `forge-cli/workflows/agents-md.md`, `forge-cli/templates/agents.md.tmpl`, `forge-cli/bin/forge-tools.cjs` (`agents-md generate|check|diff`).
- **Config flag:** None — it just writes a file the user can commit or ignore.
- **Back-compat:** Existing `CLAUDE.md` untouched. `AGENTS.md` is additive.

#### 4.5.2 `forge-mcp` server — expose Forge intelligence to any agent runtime

- **Why:** The MCP ecosystem (14,000+ servers per Noisy's number) is how Codex, OpenHands, Cursor consume capabilities. Forge has no MCP surface — its code graph, verifier, and impact analyzer are walled off.
- **Change:** New module `forge-mcp/` shipping a stdio MCP server exposing four resources and six tools:
  - **Resources:** `forge://graph/overview`, `forge://graph/hotspots`, `forge://session/ledger`, `forge://phases/<id>/PLAN.md`.
  - **Tools:** `graph.show(file)`, `graph.impact(file)`, `graph.capabilities(module)`, `verify.run(files, layers)`, `assess.plan(planPath)`, `audit.tail(limit)`.
  - Read-only by default. A `--write` mode (off by default) exposes `plan.create`, `phase.execute`, gated by capability tokens.
- **Target files:** `forge-mcp/server.js`, `forge-mcp/tools/*.js`, `forge-cli/templates/mcp-config.snippets/{claude-code,codex,cursor,openhands}.json`.
- **Config flag:** `mcp.server.enabled` (default `false`); `mcp.server.transport = stdio | sse`.
- **Back-compat:** New module; nothing else touched. Same code graph; new consumer.

#### 4.5.3 Agent / Skill marketplace adapter

- **Why:** Forge has 21 hardcoded agent personas in `forge-agents/catalog/`. Google `skills` and VoltAgent's awesome-claude-code-subagents (131+) demonstrate the marketplace model. Forge should consume — not duplicate — these.
- **Change:** New CLI: `forge-tools.cjs skills add <source>`. Supports:
  - `google/skills` (Apache-2.0 Google packs).
  - `voltagent/awesome-claude-code-subagents` (the 131-agent pack).
  - Any `npm` package whose `package.json#forge.skillPack` field points at a directory of `SKILL.md`-shaped files.
  - Any local directory.
  Each installed pack lands in `~/.claude/skills/<pack>/` (or `.claude/skills/<pack>/` for project-scoped). The factory's `agent-registry.js` already discovers `~/.claude/agents/` — extend it to walk `~/.claude/skills/` with the same precedence rules.
  Forge wraps every external skill at runtime: injects the SDLC verification loop, the action-observation log, the ledger awareness directive. The skill stays unchanged on disk; the wrapping is invisible to the skill author.
- **Target files:** `forge-cli/bin/forge-tools.cjs` (subcommand `skills`), `forge-agents/agent-registry.js` (extend discovery), `forge-agents/skill-wrapper.js` (new).
- **Config flag:** `skills.allow_external = true | false` (default `true`).
- **Back-compat:** The 21 built-in personas continue to be discovered first. External skills only fill gaps.

#### 4.5.4 Runtime adapters (Claude Code, Codex, OpenHands, Gemini)

- **Why:** `forge-agents/provider.js` today detects `claude` and `codex` binaries. The architecture is close to multi-runtime but the dispatch is shallow.
- **Change:** Promote each runtime to a first-class adapter:
  ```
  forge-runtimes/claude-code/{spawn.js,flags.js,allowedTools.js}
  forge-runtimes/codex/{spawn.js,flags.js}
  forge-runtimes/openhands/{spawn.js,sdk-bridge.py}
  forge-runtimes/gemini-cli/{spawn.js,flags.js}
  ```
  Each adapter implements `spawnAgent(systemPrompt, contextPaths, capabilities, envScope) → Promise<RunResult>`. Selection is driven by `runtime.preferred` config + auto-detection. OpenHands integration uses the SDK pattern from the Noisy article (Python bridge invoked over stdio).
- **Target files:** new `forge-runtimes/`, refactor `forge-agents/provider.js` to delegate.
- **Config flag:** `runtime.preferred = auto | claude-code | codex | openhands | gemini-cli`.
- **Back-compat:** `auto` reproduces today's claude-then-codex behavior bit-for-bit.

#### 4.5.5 Action-replay → cross-runtime portability

- The action-observation log from 4.4.6 + the runtime adapter from 4.5.4 give Forge something none of the listed runtimes have alone: **replay a wave on a different runtime**. Useful for:
  - Comparing Claude Sonnet 4.6 vs Opus 4.7 vs Gemini on the same plan.
  - Reproducing a failed wave deterministically.
  - Enterprise procurement evaluations.

---

## 5. Implementation Plan — 8 Phases

Each phase ships independently. Numbered to map onto Forge milestones.

| Phase | Goal | Modules touched | New config flags | Effort |
|---|---|---|---|---|
| **P1 — Shell-string elimination & input validation** | Remove every `execSync(\`…\${var}\`)` site; add CLI arg validator. | `forge-graph/updater.js`, `forge-containers/*orchestrator.js`, `forge-agents/provider.js`, `forge-cli/lib/exec.js` (new) | none | S |
| **P2 — Redaction + audit log + identity** | Sensitive-data scrubber, signed `audit.jsonl`, project identity keypair. | `forge-session/{redactor,audit,identity}.js`, `forge-cli/bin/forge-tools.cjs` | `audit.enabled`, `session.redaction.enabled` | M |
| **P3 — Container hardening + env allowlist + egress proxy** | Drop caps, seccomp, allowlisted egress, scoped env. | `forge-containers/container-spec.js`, `forge-containers/egress-proxy/`, `forge-agents/provider.js`, policy files in `.forge/policy/` | `security.env_allowlist.enabled`, `containers.hardened`, `containers.egress.mode` | L |
| **P4 — Capability-scoped agent permissions (RBAC-lite)** | Plan declares capabilities; factory translates to allowedTools/env/egress. Optional OIDC adapter. | `forge-agents/{factory,capabilities}.js`, `forge-session/identity-adapters/*` | `security.capabilities.enforce`, `identity.adapter` | M |
| **P5 — Performance pass** | Tokenizer adapters, async hot paths, SQLite tuning, verify cache. | `forge-assess/tokenizers/*`, `forge-session/metrics-batcher.js`, `forge-graph/query.js`, `forge-verify/cache.js` | `assess.tokenizer`, `verify.cache.enabled` | S |
| **P6 — Quality + observability + supply chain** | Test floor, `// @ts-check`, structured logger, OTEL exporter, SBOM, cosign. | new tests, `tsconfig.check.json`, `forge-cli/lib/logger.js`, `forge-session/otel.js`, `.github/workflows/release.yml` | `telemetry.otel.endpoint`, `log.level`, `log.json` | M |
| **P7 — `AGENTS.md` generator + action-observation log** | Cross-runtime onboarding doc + replay log. | `forge-cli/workflows/agents-md.md`, `forge-cli/templates/agents.md.tmpl`, `forge-session/actions.js` | `actions.log.enabled` | S |
| **P8 — Ecosystem: `forge-mcp` + skill marketplace + runtime adapters** | MCP server, `skills add`, `forge-runtimes/*`. | new `forge-mcp/`, `forge-runtimes/{claude-code,codex,openhands,gemini-cli}/`, `forge-agents/agent-registry.js`, `forge-tools.cjs skills` | `mcp.server.enabled`, `skills.allow_external`, `runtime.preferred` | L |

Sequence rationale: P1–P3 are pure hardening that unblocks enterprise pilots without touching workflow. P4 introduces the capability model that P3's enforcement reads. P5–P6 are quality-of-life. P7–P8 are the strategic ecosystem expansions and depend on P4's capability model.

---

## 6. Backwards-Compatibility Plan

Per-phase compatibility checklist (executor agents must follow this):

1. Read the existing v1 file format before writing the v2 form.
2. New config keys appear in defaults with safe values; absence is treated as default.
3. No removed CLI flags; deprecated flags log a warning and still work for one minor version.
4. `forge-doctor` gains a check for each new flag and tells the user which features they're missing if a flag is off.
5. `forge-graph` schema migrations run on the next graph open after upgrade; never destructive without a backup at `.forge/code-graph.db.bak.<timestamp>`.
6. `audit.jsonl`, `actions/*.jsonl`, `agents.md` are all additive files in additive directories.
7. Every new module that wraps an existing one (env scoper, action log, etc.) provides a passthrough mode where it is a no-op.

---

## 7. Verification Strategy for the Plan Itself

Before each phase merges:

1. **Forge eats its own dog food** — every phase plan is created via `/forge-plan-phase` and verified via `/forge-verify-work` using the existing 16-layer engine.
2. **Regression suite** — the existing 7 test files + the new tests added in P6 must pass.
3. **Workflow smoke test** — a scripted end-to-end run: `/forge-init → /forge-new-project → /forge-plan-phase → /forge-execute-phase → /forge-verify-work` on a tiny fixture project must complete with no behavior delta in defaults.
4. **Doctor pass** — `node forge-cli/bin/forge-tools.cjs doctor` returns green.
5. **Security audit pass** — `scripts/audit-shell-strings.sh` reports zero hits; `npm audit --omit=dev` clean.
6. **Type-check pass** — `tsc -p tsconfig.check.json --noEmit` clean for modules carrying `// @ts-check`.

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Egress allowlist breaks legitimate research agents that need package installs. | Profiles (`strict` / `build` / `research`). Each plan declares the profile it needs; default is `strict`. |
| Capability enforcement breaks today's plans that don't declare capabilities. | Start in `warn` mode for two versions before flipping to `enforce`. |
| Encryption-at-rest loses data when the key is unreachable. | Backup key flow + `forge-tools.cjs vault export <encrypted-bundle>`; refuse to migrate without verified write-back. |
| MCP server exposes graph data the user doesn't want shared. | Read-only by default; per-resource ACL in `.forge/policy/mcp.allowlist.yaml`. |
| Multiple runtime adapters drift in behavior, breaking replay. | Adapter conformance test suite — every adapter runs the same 30-step fixture and produces normalized action records. |
| AGENTS.md drifts from CLAUDE.md. | `agents-md check` is a Forge doctor step; CI gate optional. |
| OTEL/Sigstore optional deps fail to install on air-gapped machines. | Lazy import — Forge runs identically with the deps absent; only the corresponding feature is unavailable. |
| External skill packs ship malicious instructions. | Skill-wrapper sandboxes them with the capability model + egress profile; `skills add` shows source URL + sha256 + signature status. |

---

## 9. What Stays Untouched (Explicit)

- `/forge-init`, `/forge-plan-phase`, `/forge-execute-phase`, `/forge-verify-work`, `/forge-auto`, `/forge-progress`, `/forge-impact`, `/forge-doctor`, `/forge-graph-*`, `/forge-new-project`, `/forge-new-milestone`, `/forge-complete-milestone`, `/forge-audit-milestone` — all 42 commands keep their interface.
- `.planning/REQUIREMENTS.md` lifecycle and schema.
- `ROADMAP.md`, `PLAN.md`, `SUMMARY.md`, `VERIFICATION.md` frontmatter contracts.
- `.forge/session/ledger.md` Markdown format and `proper-lockfile` semantics.
- 16-layer verification engine layer ordering and toggle keys.
- `.forge/config.json` merge order (defaults ← `~/.forge/config.json` ← `.forge/config.json`).
- Code-graph schema reads (v1 graphs remain readable after migration).
- The 21 built-in agent personas in `forge-agents/catalog/`.
- Hook contracts in `hooks/dist/`.

---

## 10. One-Page Outcome Summary

After all 8 phases land, Forge becomes:

- A **hardened sandbox** (scoped env, capability-gated agents, locked-down containers, egress-proxied).
- A **compliance-ready system** (signed append-only audit log, project identity, optional OIDC SSO, encryption-at-rest, SBOM + cosign).
- A **measurable system** (OTEL traces, action-observation logs, structured JSON logs, ≥ 60% test coverage on core).
- A **multi-runtime** orchestrator (Claude Code, Codex, OpenHands, Gemini CLI) consuming **external skill packs** (Google `skills`, VoltAgent 131 agents) — *while keeping the Forge SDLC verification loop wrapped around every one of them*.
- A **first-class MCP citizen** — Forge's graph, verification, and impact analyzer become tools any external agent can call.

…and every existing `/forge-*` command keeps working exactly as it does today.
