# Capability-Scoped Agent Permissions (RBAC-lite)

Forge's P4 feature lets every plan declare exactly what an agent is allowed to
do. The factory translates declared capabilities into:

- Claude Code `--allowedTools` / `--disallowedTools` flags
- Container env scope (`secrets_scope`, see scope-env.js)
- Egress proxy profile (`off | strict | build | research`)
- A pre-flight check that rejects writes outside declared paths

## Declaring capabilities in a plan

Add a `capabilities:` list to plan frontmatter:

```yaml
---
phase: 1
objective: Add a new dependency
capabilities: [read_src, write_src, write_tests, run_tests, network_npm]
---
```

Plans that omit `capabilities:` fall back to the legacy "all tools" behaviour
when `security.capabilities.enforce` is `off` or `warn`. When enforcement is
`enforce`, an undeclared plan resolves to the most restrictive fallback
(read-only tools, no egress).

## Catalog

| Capability         | Allowed Tools                              | Writable Paths                 | Egress    | Secrets                       |
|--------------------|--------------------------------------------|--------------------------------|-----------|-------------------------------|
| `read_src`         | Read, Glob, Grep                           | —                              | off       | —                             |
| `read_docs`        | Read, Glob, Grep                           | —                              | off       | —                             |
| `write_src`        | Read, Edit, Write, Glob, Grep, Bash        | `src/`, `lib/`, `forge-*/`     | off       | —                             |
| `write_docs`       | Read, Edit, Write, Glob, Grep              | `docs/`, `*.md`, `.planning/`  | off       | —                             |
| `write_tests`      | Read, Edit, Write, Glob, Grep, Bash        | `tests/`, `**/*.test.*`        | off       | —                             |
| `run_tests`        | Bash, Read, Glob, Grep                     | —                              | off       | `CI`                          |
| `run_build`        | Bash, Read, Write, Edit, Glob, Grep        | `build/`, `dist/`, `.cache/`   | build     | —                             |
| `network_npm`      | Bash, Read, Glob                           | `node_modules/`, lockfiles     | build     | `NPM_TOKEN`                   |
| `network_research` | Read, Glob, Grep, WebFetch, WebSearch      | —                              | research  | —                             |
| `llm_call`         | Bash, Read, Glob, Grep                     | —                              | strict    | `ANTHROPIC_API_KEY`, …        |
| `git_local`        | Bash, Read, Glob, Grep                     | `.git/`                        | off       | —                             |
| `git_remote`       | Bash, Read, Glob, Grep                     | `.git/`                        | strict    | `GITHUB_TOKEN`, `GH_TOKEN`    |

Multiple capabilities compose: tools are unioned, write_paths concatenated,
egress widens to the broadest profile (`research > build > strict > off`).

## Enforcement modes

Set in `.forge/config.json`:

```json
{
  "security": { "capabilities": { "enforce": "warn" } }
}
```

| Mode      | Behaviour                                                              |
|-----------|------------------------------------------------------------------------|
| `off`     | Capabilities ignored (legacy)                                          |
| `warn`    | Pre-flight check logs violations to warnings; patches still applied    |
| `enforce` | Violations downgrade status to error; container drops `--dangerously…` |

## CLI

```bash
node forge-cli/bin/forge-tools.cjs capabilities list
node forge-cli/bin/forge-tools.cjs capabilities describe write_docs
node forge-cli/bin/forge-tools.cjs capabilities resolve write_docs,run_tests
node forge-cli/bin/forge-tools.cjs capabilities check src/app.js --plan plan.md
node forge-cli/bin/forge-tools.cjs capabilities mode
```

`resolve` prints the materialised policy (`allowedTools`, `disallowedTools`,
`writePaths`, `readPaths`, `egress`, `secretsScope`, `unknown`).
`check` evaluates one file against the plan's declared capabilities.

## Pre-flight check (write_paths)

After Claude finishes, the orchestrator/worktree runner walks every modified
file and checks it against the agent's `writePaths` globs:

- `**` matches any depth (zero or more segments)
- `*` matches one path segment
- `!prefix` is an exclusion (e.g., `!**/node_modules/**`)
- Anything else is a literal prefix

If any file falls outside the declared paths it becomes a `rbac_violation`
entry in `learnings.warnings` and (in `enforce` mode) the agent status is set
to `rbac_violation` and patches are discarded.

## Integration sketch

```
plan.md           — declares capabilities: [...]
forge-agents/factory.js
  └─ analyzeTask + resolve(caps)
       ↓ agentConfig.rbac = { allowedTools, disallowedTools, writePaths, egress, secretsScope }
forge-containers/worktree-orchestrator.js
  └─ invokeProvider(prompt, wt, { allowedTools, disallowedTools, secrets_scope, ... })
       ↓
forge-agents/provider.js buildInvocation()
  └─ claude --allowedTools <csv> --disallowedTools <csv>
       (drops --dangerously-skip-permissions when enforce + capabilities set)
forge-containers/agent-entrypoint.js (in-container) OR
forge-containers/worktree-orchestrator.js (post-run)
  └─ checkRbacViolations(rbac, collection) → result.rbacViolations
```

## Adding a capability

Edit `forge-agents/capabilities.js`:

```js
const CAPABILITIES = {
  // ... existing ...
  read_secrets_metadata: {
    tools: ['Read', 'Glob'],
    write_paths: [],
    read_paths: ['.forge/policy/**'],
    egress: 'off',
    secrets: [],
  },
};
```

No build step; the change is picked up on the next agent build.
