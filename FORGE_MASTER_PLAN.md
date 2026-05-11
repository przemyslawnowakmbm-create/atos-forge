# Forge — Master Remediation Plan

> **Canonical, CLI-executable fix roadmap.** Consolidates all findings
> from the four prior documents:
> 1. `FORGE_FIXING_PLAN.md` — first audit (7 runtime bugs, simulation-proven)
> 2. `FORGE_VALIDATION_PLAN.md` — main audit (12 system-level findings)
> 3. `FORGE_VALIDATION_PLAN_ADDENDUM_RESEARCHER.md` — researcher subsystem (9 findings)
> 4. `FORGE_VALIDATION_PLAN_ADDENDUM_2.md` — final pass (9 findings + 1 self-correction)
>
> **Total: 37 findings, grouped into 27 actionable fixes across 4 phases.**
>
> **For the CLI agent executing this plan.** The document is ordered
> strictly by dependency: earlier fixes are prerequisites for later
> ones. Work in order. Commit per fix. Run the acceptance step after
> every fix before moving on. Do NOT bundle fixes into one commit.
> Do NOT refactor outside the declared scope. If an acceptance command
> fails, stop and surface — do not silently adjust the check.

---

## Contents

- [0. Critical correction you MUST apply first](#0-critical-correction)
- [1. Baseline harness (reproduce the broken state before fixing)](#1-baseline-harness)
- [2. Out of scope (do not touch)](#2-out-of-scope)
- [3. Phase 0 — Foundation: parsing, contract, verification](#phase-0)
- [4. Phase 1 — Correctness: pipeline integrity](#phase-1)
- [5. Phase 2 — Test integrity and coverage](#phase-2)
- [6. Phase 3 — Token efficiency](#phase-3)
- [7. Acceptance gates per phase](#7-acceptance-gates)
- [8. Findings → fix traceability matrix](#8-traceability)
- [9. Appendices (simulation fixtures, PLAN template, reference implementation)](#9-appendices)

---

<a id="0-critical-correction"></a>
## 0. Critical correction you MUST apply first

The audit's view tooling rendered literal `<name>...</name>` tags as
`<n>...</n>` in some outputs. Two places in this plan's own earlier
drafts therefore contain the wrong tag. When you see a regex or
template containing `<n>` and `</n>` while targeting a **task name**,
the actual bytes are `<name>` and `</name>`. Verify with
`grep "name>Task" <file> | od -c` before writing any regex.

Specifically:
- In **Fix 2** (task-tag parser), the correct regex for extracting
  the task name is `const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);`
- In **Fix 4** (`splitter.js::formatSubPlanXML`), the emitted tag
  must be `<name>${subPlan.name}</name>`.

Do not trust visual rendering of `<n>`/`<name>` tag content when
planning regex changes. Check byte-level with `od -c`.

---

<a id="1-baseline-harness"></a>
## 1. Baseline harness — reproduce the broken state before any fix

Before changing any code, prove the baseline is broken. This guards
against "fixed something else" drift.

### 1.1 Clone and install

```bash
cd /tmp && rm -rf forge-cli-fix
git clone <repo-url> forge-cli-fix
cd forge-cli-fix
git checkout -b fix/master-remediation

cd forge-graph && npm install --no-audit --no-fund && cd ..
node forge-cli/bin/forge-tools.cjs doctor
```

### 1.2 Set up the simulation project

```bash
SIM=/tmp/forge-sim && rm -rf "$SIM" && mkdir -p "$SIM" && cd "$SIM"
git init -q && git config user.email sim@local && git config user.name sim
mkdir -p src/components src/api/feedback src/lib .planning/phases/01-feedback-form
echo "node_modules/" > .gitignore

cat > package.json <<'EOF'
{ "name": "sim-project", "version": "0.1.0", "private": true, "type": "module" }
EOF

cat > src/lib/db.js <<'EOF'
const _store = { feedback: [] };
export function insertFeedback(record) {
  const row = { id: _store.feedback.length + 1, createdAt: new Date().toISOString(), ...record };
  _store.feedback.push(row);
  return row;
}
export function listFeedback() { return [..._store.feedback]; }
EOF

cat > src/components/Layout.jsx <<'EOF'
export function Layout({ children }) {
  return (<div className="layout"><header><h1>Sim App</h1></header><main>{children}</main></div>);
}
EOF

cat > src/api/health.js <<'EOF'
export function GET() {
  return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
}
EOF

cat > .planning/REQUIREMENTS.md <<'EOF'
# Project Requirements
## Phase 01: User Feedback Form
| ID    | Description | Phase | Status |
|-------|-------------|-------|--------|
| FB-01 | User can open a feedback form from any page via a "Send feedback" button in the layout header | 01 | pending |
| FB-02 | Form accepts a message (1-500 chars) and an optional email | 01 | pending |
| FB-03 | Submitting the form POSTs to /api/feedback and stores the record in the database | 01 | pending |
| FB-04 | After successful submit, the user sees a confirmation toast and the form clears | 01 | pending |
| FB-05 | Submission failures show an inline error and the form preserves user input | 01 | pending |
EOF
```

Write the spec-compliant `PLAN.md` from [Appendix A](#appendix-a) to
`.planning/phases/01-feedback-form/01-01-PLAN.md`.

### 1.3 Build the graph and drop the deliberately-broken stub

```bash
cd "$SIM"
FORGE=/tmp/forge-cli-fix
node "$FORGE/forge-graph/builder.js" .
```

Then write the broken stub files from [Appendix B](#appendix-b).

### 1.4 Confirm the four baseline failures

```bash
# B1: parsePlan drops must_haves and finds 0 tasks
node -e "const a=require('$FORGE/forge-assess/assessor.js'); const p=a.parsePlan('.planning/phases/01-feedback-form/01-01-PLAN.md'); console.log({tasks:p.tasks.length, fmKeys:Object.keys(p.frontmatter), objective:p.objective.length});"
# EXPECTED BUG: { tasks: 0, fmKeys: [ 'wave', 'depends_on', 'autonomous' ], objective: 0 }

# B2: factory output has no plan_meta.frontmatter.must_haves
node "$FORGE/forge-agents/factory.js" build .planning/phases/01-feedback-form/01-01-PLAN.md --root . > /tmp/agent.json
node -e "const c=JSON.parse(require('fs').readFileSync('/tmp/agent.json')); console.log('must_haves in fm?', 'must_haves' in (c.agentConfig.plan_meta.frontmatter||{}));"
# EXPECTED BUG: must_haves in fm? false

# B3: verify artifacts cannot find the block
node "$FORGE/forge-cli/bin/forge-tools.cjs" verify artifacts .planning/phases/01-feedback-form/01-01-PLAN.md
# EXPECTED BUG: { "error": "No must_haves.artifacts found in frontmatter" }

# B4: 6-layer engine returns PASS for broken implementation
node "$FORGE/forge-verify/engine.js" --root . --files src/components/Layout.jsx,src/components/FeedbackButton.jsx,src/components/FeedbackForm.jsx,src/api/feedback/route.js --plan .planning/phases/01-feedback-form/01-01-PLAN.md --json | grep '"overall"'
# EXPECTED BUG: "overall": "PASS"
```

If any of B1-B4 does not show the bug, stop and re-confirm with the user. Either
the baseline is unexpected or the bug has already been fixed.

---

<a id="2-out-of-scope"></a>
## 2. Out of scope — do not touch

- The agent prompt files under `agents/*.md` (they are correct — the runtime
  is wrong).
- The `forge-graph` engine, schema, or query API.
- The `forge-config` doctor or settings UI.
- The container orchestrator's Docker logic (only the result-collection
  path is touched in Fix 8).
- `CLAUDE.md`, `AGENTS.md`, `README.md`, the dashboard, or skill sources.
- Decimal phase numbering logic (verified correct).
- `forge-system` / `forge-analyze` cross-repo subsystems (optional features,
  out of scope unless cross-repo is actively used).

If a fix appears to require changes outside its scope, **stop and escalate**
— do not expand.

---

<a id="phase-0"></a>
## 3. Phase 0 — Foundation (~1 week)

**Objective:** the seven simulation-proven bugs from the first audit.
Every later phase depends on these. Do not start Phase 1 until Phase 0 is
fully landed and the baseline harness (section 1.4) no longer shows the
bugs.

---

### Fix 1 — Use a real YAML parser

**Severity:** Critical. Every downstream stage (factory, splitter, verifier) depends on `must_haves` and other frontmatter fields surviving the parse step.

**Files:**
- `forge-assess/package.json` (create if missing)
- `forge-assess/assessor.js` — function `parsePlan` (~line 89)
- `forge-cli/bin/lib/frontmatter.cjs` — function `parseMustHavesBlock` (~line 155)
  and `extractFrontmatter`

**Approach:**

1. Add the `yaml` package (eemeli/yaml, MIT, pure JS, no native deps):
   ```bash
   cd forge-assess
   # if package.json missing:
   cat > package.json <<'EOF'
   { "name": "@forge/assess", "version": "0.1.0", "private": true,
     "main": "assessor.js", "dependencies": { "yaml": "^2.6.0" } }
   EOF
   npm install --no-audit --no-fund
   ```
   Also add `"yaml": "^2.6.0"` to the root `package.json` `dependencies`.

2. In `assessor.js::parsePlan`, replace the hand-rolled regex block
   (waveMatch, depsMatch, autoMatch, files_modified extraction) with:
   ```js
   const YAML = require('yaml');
   // ...
   const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
   if (fmMatch) {
     let parsed = {};
     try {
       parsed = YAML.parse(fmMatch[1]) || {};
     } catch (e) {
       console.error(`[parsePlan] YAML error in ${planPath}: ${e.message}`);
       parsed = {};
     }
     plan.frontmatter = {
       wave: parsed.wave ?? 1,
       depends_on: Array.isArray(parsed.depends_on) ? parsed.depends_on : [],
       autonomous: parsed.autonomous !== false,
       ...parsed,     // expose every field: phase, plan, type, requirements,
                      // must_haves, has_tests, service, repo, role, etc.
     };
     plan.files_modified = Array.isArray(parsed.files_modified)
       ? parsed.files_modified
       : (typeof parsed.files_modified === 'string' ? [parsed.files_modified] : []);
   }
   ```

3. In `frontmatter.cjs::parseMustHavesBlock`, replace the rigid indent
   parser with:
   ```js
   const YAML = require('yaml');
   function parseMustHavesBlock(content, blockName) {
     const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
     if (!fmMatch) return [];
     let parsed;
     try { parsed = YAML.parse(fmMatch[1]) || {}; } catch { return []; }
     const block = parsed?.must_haves?.[blockName];
     return Array.isArray(block) ? block : [];
   }
   ```
   Update `extractFrontmatter` to use `YAML.parse` and return the parsed object.

**Acceptance:**
```bash
cd "$SIM"
node -e "const a=require('$FORGE/forge-assess/assessor.js'); const p=a.parsePlan('.planning/phases/01-feedback-form/01-01-PLAN.md'); console.log({ fmKeys: Object.keys(p.frontmatter).sort(), hasMustHaves: !!p.frontmatter.must_haves, truths: p.frontmatter.must_haves?.truths?.length, keyLinks: p.frontmatter.must_haves?.key_links?.length, requirements: p.frontmatter.requirements?.length });"
# EXPECTED: fmKeys includes 'must_haves','requirements','phase','plan','type','has_tests'
#           hasMustHaves: true, truths: 7, keyLinks: 4, requirements: 5

node "$FORGE/forge-cli/bin/forge-tools.cjs" verify artifacts .planning/phases/01-feedback-form/01-01-PLAN.md
# EXPECTED: returns list (3/5 fail, 2/5 pass), not "No must_haves.artifacts found"
```

**Commit:** `fix(assess): use real YAML parser for plan frontmatter and must_haves`

---

### Fix 2 — Parse `<task type="...">` and `<objective>` tags

**Severity:** Critical. Spec-compliant plans currently parse as 0 tasks.

**File:** `forge-assess/assessor.js::parsePlan` (after the frontmatter
block, ~lines 127 and 156)

**Problem:** The regex `/<task>([\s\S]*?)<\/task>/g` does not match
`<task type="auto">` (the spec form). The objective extractor only
matches `## Objective` markdown headings, not `<objective>` tags.

**Approach:**

1. Replace the task regex:
   ```js
   const taskRegex = /<task\b[^>]*>([\s\S]*?)<\/task>/g;
   ```
   Inside the loop, also extract optional `type` attribute and
   optional `<name>` tag (**NOTE: tag is `<name>`, not `<n>`** —
   see Section 0):
   ```js
   const typeMatch = taskMatch[0].match(/<task\b[^>]*\btype="([^"]+)"/);
   const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);
   plan.tasks.push({
     type: typeMatch ? typeMatch[1] : 'auto',
     name: nameMatch ? nameMatch[1].trim() : '',
     files, action, verify, done,
   });
   ```

2. Add `<objective>` tag support before the `## Objective` fallback
   (keep both for backwards compat):
   ```js
   const objTagMatch = raw.match(/<objective>([\s\S]*?)<\/objective>/);
   const objMdMatch  = raw.match(/##\s*Objective\s*\n([\s\S]*?)(?=\n##|\n<|\Z)/);
   plan.objective = (objTagMatch?.[1] || objMdMatch?.[1] || '').trim();
   ```

**Acceptance:**
```bash
cd "$SIM"
node -e "const a=require('$FORGE/forge-assess/assessor.js'); const p=a.parsePlan('.planning/phases/01-feedback-form/01-01-PLAN.md'); console.log({ tasks: p.tasks.length, types: p.tasks.map(t=>t.type), names: p.tasks.map(t=>t.name), objLen: p.objective.length });"
# EXPECTED: tasks: 4, types: ['auto','auto','auto','auto'], substantive names, objLen > 50
```

**Commit:** `fix(assess): parse <task type="..."> and <objective> tags per planner spec`

---

### Fix 3 — Key-link patterns must match in source, never target

**Severity:** Critical. 2 of 3 broken wirings pass with false positives today.

**File:** `forge-cli/bin/lib/verify.cjs::cmdVerifyKeyLinks` (~lines 260-274)

**Problem:** Current logic tries pattern in source, then falls back to
target. Searching for `FeedbackForm` in `FeedbackForm.jsx` trivially
matches (self-reference), so a button that doesn't render the form
passes anyway.

**Approach:** Remove the target fallback. Patterns represent wiring markers — they must always be in the source.

```js
} else if (link.pattern) {
  try {
    const regex = new RegExp(link.pattern);
    if (regex.test(sourceContent)) {
      check.verified = true;
      check.detail = 'Pattern found in source';
    } else {
      check.detail = `Pattern "${link.pattern}" not found in source`;
    }
  } catch {
    check.detail = `Invalid regex pattern: ${link.pattern}`;
  }
}
```

For the no-pattern path (`sourceContent.includes(link.to)`), keep the existing source-only check — that one was correct.

**Acceptance:**
```bash
cd "$SIM"
node "$FORGE/forge-cli/bin/forge-tools.cjs" verify key-links .planning/phases/01-feedback-form/01-01-PLAN.md
# EXPECTED: verified: 1 / 4
# Only Layout->FeedbackButton is genuinely wired; 3 broken links marked verified: false.
```

**Commit:** `fix(verify): key-link patterns must match in source, never target`

---

### Fix 4 — Propagate parent contract into sub-plans

**Severity:** Critical. After any split, agents receive "Implement changes for: <files>" with no contract.

**File:** `forge-assess/splitter.js::buildSubPlan` (~lines 705-743) and
`formatSubPlanXML` / `formatSubPlanJSON` (~line 749)

**Approach:**

In `buildSubPlan`, after constructing the existing `result` object, attach a
`parent_contract` with relevant filtered fields:

```js
const fm = plan.frontmatter || {};
const mh = fm.must_haves || {};
const fileSet = new Set(group.files);
const relevantKeyLinks = (mh.key_links || []).filter(kl =>
  fileSet.has(kl.from) || fileSet.has(kl.to)
);
const relevantArtifacts = (mh.artifacts || []).filter(a =>
  fileSet.has(a.path)
);
result.parent_contract = {
  objective: plan.objective || '',
  requirements: fm.requirements || [],
  truths: mh.truths || [],                   // full list — applies to whole goal
  key_links: relevantKeyLinks,               // filtered to sub-plan's files
  artifacts: relevantArtifacts,              // filtered similarly
  parent_must_haves_full: mh,                // full block for verifier reference
};
```

Update `formatSubPlanXML` so the contract round-trips into YAML when sub-plans
are written to disk (simplest path: emit the `parent_contract` back into the
sub-plan's frontmatter under `must_haves:` so the factory's parser picks it
up automatically — see **note at end** of this section about dual approach).

Update `formatSubPlanJSON` to include `parent_contract` in output.

**Remember:** any `<name>` tag must be `<name>...</name>` — not `<n>...</n>` (Section 0).

**Acceptance:**
```bash
cd "$SIM"
node -e "
const a = require('$FORGE/forge-assess/assessor.js');
const s = require('$FORGE/forge-assess/splitter.js');
const p = a.parsePlan('.planning/phases/01-feedback-form/01-01-PLAN.md');
const rec = { strategy: 'concern', reason: 'forced',
  metrics: { total_estimated: 12522, context_limit: 160000, overflow_ratio: 0.08 },
  suggested_subtask_count: 4, file_groups: [] };
const out = s.splitPlan(p, rec, '.', { format: 'json' });
for (const sp of out.sub_plans) {
  const c = sp.parent_contract || {};
  console.log(sp.subtask, sp.files.length, 'files | reqs:', c.requirements,
    '| truths:', c.truths?.length, '| keyLinks:', c.key_links?.length);
}
"
# EXPECTED: each sub-plan shows requirements: ['FB-01',...], truths: 7, keyLinks: >=1
```

**Commit:** `feat(assess): propagate must_haves and requirements into sub-plans`

**Note on the dual approach:** Fix 4 and Fix 5 can share the mechanism.
The cleanest implementation writes the filtered contract back into the
sub-plan's YAML frontmatter under `must_haves:` so the factory's parser
picks it up without code changes. Alternatively, carry `parent_contract`
as a sibling field read explicitly by the factory. Pick one approach.
YAML re-emission is preferred because it requires no factory changes.

---

### Fix 5 — Inject plan contract into agent system prompt

**Severity:** Critical. System prompt has zero structured contract today.

**File:** `forge-agents/factory.js::composeSystemPrompt` (~lines 422-630)

**Approach:**

After the `## LOCKED DECISIONS` section (~line 572), before `buildGroundingSection`, add:

```js
// Plan contract — must_haves and requirements from frontmatter
const fm = analysis.plan?.frontmatter || {};
const mh = fm.must_haves || {};
const reqs = Array.isArray(fm.requirements) ? fm.requirements : [];
if (reqs.length || mh.truths?.length || mh.key_links?.length || mh.artifacts?.length) {
  parts.push('\n## Plan Contract (the goal — every truth must be true on completion)');
  if (analysis.plan?.objective) {
    parts.push(`\n**Objective:** ${analysis.plan.objective}`);
  }
  if (reqs.length) {
    parts.push(`\n**Requirements implemented by this plan:** ${reqs.join(', ')}`);
  }
  if (mh.truths?.length) {
    parts.push('\n**Observable truths (each must be verifiable on the running app):**');
    mh.truths.forEach((t, i) => parts.push(`${i + 1}. ${t}`));
  }
  if (mh.artifacts?.length) {
    parts.push('\n**Required artifacts:**');
    for (const a of mh.artifacts) {
      const extras = [];
      if (a.min_lines) extras.push(`>=${a.min_lines} lines`);
      if (a.contains)  extras.push(`contains "${a.contains}"`);
      if (a.exports)   extras.push(`exports ${(Array.isArray(a.exports) ? a.exports : [a.exports]).join(', ')}`);
      const tail = extras.length ? ` (${extras.join('; ')})` : '';
      parts.push(`- \`${a.path}\` — ${a.provides || ''}${tail}`);
    }
  }
  if (mh.key_links?.length) {
    parts.push('\n**Required wiring (these connections will be checked by the verifier — broken wiring = task failure):**');
    for (const l of mh.key_links) {
      parts.push(`- \`${l.from}\` -> \`${l.to}\` via ${l.via}${l.pattern ? ` (pattern: \`${l.pattern}\`)` : ''}`);
    }
  }
  parts.push('\nDo NOT mark any task complete unless the wiring above is in place. Stub handlers, orphan imports, and placeholder returns are FAILURES, not completions.');
}

// If the plan was split, the parent contract may live on plan.parent_contract:
if (analysis.plan?.parent_contract) {
  const pc = analysis.plan.parent_contract;
  parts.push('\n## Parent Plan Contract (this sub-plan contributes to the parent goal)');
  if (pc.objective)        parts.push(`**Parent objective:** ${pc.objective}`);
  if (pc.requirements?.length) parts.push(`**Requirements:** ${pc.requirements.join(', ')}`);
  if (pc.truths?.length) {
    parts.push('**Parent truths (the whole plan must achieve these):**');
    pc.truths.forEach((t, i) => parts.push(`${i + 1}. ${t}`));
  }
  if (pc.key_links?.length) {
    parts.push('**Wiring this sub-plan owns:**');
    for (const l of pc.key_links) {
      parts.push(`- \`${l.from}\` -> \`${l.to}\` via ${l.via}`);
    }
  }
}
```

**Acceptance:**
```bash
cd "$SIM"
node "$FORGE/forge-agents/factory.js" build .planning/phases/01-feedback-form/01-01-PLAN.md --root . > /tmp/agent.json
node -e "
const c = JSON.parse(require('fs').readFileSync('/tmp/agent.json'));
const sp = c.agentConfig.system_prompt;
const checks = ['Plan Contract','Send feedback','FeedbackButton','FeedbackForm','/api/feedback','insertFeedback','FB-01','FB-02','FB-03'];
for (const k of checks) console.log(sp.includes(k) ? 'OK ' : 'MISSING ', k);
"
# EXPECTED: every line says OK
```

**Commit:** `feat(agents): inject plan contract into system prompt`

---

### Fix 6 — Add KEY_LINKS verification layer

**Severity:** Critical. Engine returns PASS for broken wiring today.

**Files:**
- `forge-verify/engine.js` — add `layerKeyLinks` + wire into dispatcher
- `forge-verify/loop.js` — ensure new layer triggers auto-fix loop
- `forge-config/config.js` — add to `verification.layers` schema

**Approach:**

Add the layer function:
```js
function layerKeyLinks(opts) {
  const start = Date.now();
  if (!opts.planPath) {
    return { passed: true, links: [], skipped: true, reason: 'No plan provided', duration_ms: Date.now() - start };
  }
  let parseMustHavesBlock;
  try {
    ({ parseMustHavesBlock } = require(path.join(__dirname, '..', 'forge-cli', 'bin', 'lib', 'frontmatter.cjs')));
  } catch {
    return { passed: true, links: [], skipped: true, reason: 'frontmatter parser unavailable', duration_ms: Date.now() - start };
  }
  const planContent = fs.readFileSync(path.resolve(opts.cwd, opts.planPath), 'utf8');
  const links = parseMustHavesBlock(planContent, 'key_links');
  if (!links.length) {
    return { passed: true, links: [], skipped: true, reason: 'no key_links in plan', duration_ms: Date.now() - start };
  }
  const results = [];
  for (const link of links) {
    const sourcePath = path.join(opts.cwd, link.from || '');
    let verified = false, detail = '';
    try {
      const sourceContent = fs.readFileSync(sourcePath, 'utf8');
      if (link.pattern) {
        verified = new RegExp(link.pattern).test(sourceContent);
        detail = verified ? 'pattern found in source' : `pattern "${link.pattern}" not found in source`;
      } else {
        verified = sourceContent.includes(link.to || '');
        detail = verified ? 'target referenced in source' : 'target not referenced in source';
      }
    } catch (e) {
      detail = `source unreadable: ${e.message}`;
    }
    results.push({ from: link.from, to: link.to, via: link.via, pattern: link.pattern, verified, detail });
  }
  return {
    passed: results.every(r => r.verified),
    links: results,
    broken_count: results.filter(r => !r.verified).length,
    duration_ms: Date.now() - start,
  };
}
```

Wire it as Layer 4.5 (after dependency analysis, before tests).

Update `loop.js` so failed key-links trigger an auto-fix attempt with
broken link tuples surfaced as hints to the fix agent.

Update `config.js` schema:
```js
verification: {
  layers: {
    structural: true,
    type_check: true,
    interface_contracts: true,
    dependency_analysis: true,
    key_links: true,          // NEW
    tests: true,
    behavioral: true,
  }
}
```

**Acceptance:**
```bash
cd "$SIM"
node "$FORGE/forge-verify/engine.js" --root . --files src/components/Layout.jsx,src/components/FeedbackButton.jsx,src/components/FeedbackForm.jsx,src/api/feedback/route.js --plan .planning/phases/01-feedback-form/01-01-PLAN.md --json | python3 -c "import sys,json; d=json.load(sys.stdin); print('overall:', d['overall']); kl=[l for l in d['layers'] if l['name']=='KEY_LINKS']; print('key_links layer present:', len(kl)>0); print('broken_count:', kl[0]['result'].get('broken_count') if kl else 'N/A')"
# EXPECTED: overall: FAIL ; key_links layer present: True ; broken_count: 3
```

**Commit:** `feat(verify): add KEY_LINKS layer catching broken wiring at auto-pipeline time`

---

### Fix 7 — Fix Layer 6 BEHAVIORAL `must_check` heuristic

**Severity:** High. Trivial keyword match passes most checks today.

**File:** `forge-verify/engine.js::layerBehavioral` (~line 851)

**Problem:** `const keyword = check.toLowerCase().split(' ').find(w => w.length > 3)` picks the first word >3 chars from the description and substring-matches in any file. "Form submits via fetch" becomes "does any file contain 'form'?". Trivially passes.

**Approach:** Require explicit `files + pattern` structure; skip ambiguous string-form entries with a warning:

```js
for (const check of mustChecks) {
  const checkObj = typeof check === 'string'
    ? { description: check, files: null, pattern: null }
    : check;
  if (!checkObj.files || !checkObj.pattern) {
    results.push({
      label: `must_check: ${checkObj.description}`,
      command: '(plan verification_must_check)',
      passed: true,
      skipped: true,
      stdout: 'Skipped — must_check entry needs explicit files and pattern fields',
      stderr: '',
    });
    continue;
  }
  const targets = Array.isArray(checkObj.files) ? checkObj.files : [checkObj.files];
  let regex;
  try { regex = new RegExp(checkObj.pattern); }
  catch { results.push({ label: `must_check: ${checkObj.description}`, passed: false, stdout: `Invalid regex: ${checkObj.pattern}`, stderr: '' }); continue; }
  const found = targets.some(t => {
    try { return regex.test(fs.readFileSync(path.resolve(opts.cwd, t), 'utf8')); }
    catch { return false; }
  });
  results.push({
    label: `must_check: ${checkObj.description}`,
    command: `(plan verification_must_check: ${checkObj.pattern} in ${targets.join(',')})`,
    passed: found,
    stdout: found ? 'pattern matched' : `pattern not found in ${targets.join(', ')}`,
    stderr: '',
  });
}
```

**Acceptance:** add a unit test in `tests/` that constructs a synthetic
plan with both string-form and object-form `must_check` entries, runs
`layerBehavioral` against files that do and do not match, asserts
correct pass/fail/skip outcomes.

**Commit:** `fix(verify): require explicit files+pattern for must_check; skip ambiguous entries`

---

### Fix 8 — Splitter test mode must not pollute user `src/`

**Severity:** Medium. Leaves stale synthetic files behind.

**File:** `forge-assess/splitter.js` (`--test` mode block, ~line 1050)

**Approach:**

1. Write all synthetic files to `os.tmpdir()` rather than the user's `src/`.
   Adjust synthetic plan's `files_modified` paths to the temp dir.
2. Wrap all synthetic file creation in `try { ... } finally { /* cleanup */ }`.
3. Cleanup must run on success, failure, and `process.exit`.

**Acceptance:**
```bash
cd "$SIM"
ls src/ > /tmp/before.txt
node "$FORGE/forge-assess/splitter.js" --test --root . 2>/dev/null || true
ls src/ > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
# EXPECTED: empty diff
```

**Commit:** `fix(assess): splitter test mode must not pollute user src/`

---

### Phase 0 acceptance — rerun baseline

After all 8 fixes land, re-run the baseline harness from section 1.4:

- B1: `tasks: 4`, `fmKeys includes must_haves, requirements, phase, plan, type, has_tests`, `objective > 0`
- B2: `must_haves in fm? true`
- B3: meaningful pass/fail counts, not "not found"
- B4: `overall: FAIL` (because implementation is still broken)

All four must show the correct behavior.

Add a regression test `tests/requirements-pipeline.test.cjs` that
automates the baseline harness so the suite fails if any future change
reintroduces a Phase 0 bug.

**Phase 0 commit tag:** `phase-0-foundation-complete`

---

<a id="phase-1"></a>
## 4. Phase 1 — Correctness (~3 weeks)

**Objective:** Pipeline integrity. After Phase 1 lands, broken
implementations cannot pass the auto-pipeline, malformed plans are
rejected before execution, and wave-to-wave knowledge actually flows.

---

### Fix 9 — Wire wave-to-wave findings

**Severity:** High. Currently dead code — findings are parsed but never propagated.

**Files:**
- `forge-containers/worktree-orchestrator.js` and `orchestrator.js` (post-wave handler)
- `forge-agents/factory.js` (`buildAgentConfig`)
- `forge-agents/parallel-planner.js` (wave loop)
- `forge-session/ledger.js` (add `recordWaveFindings` helper if missing)

**Approach:**

1. After each wave's patches apply:
   - Parse each agent's stdout for the `json:agent-output` fenced block (schema at `factory.js:619`).
   - Extract the `findings` array (already on `result.agentFindings`).
   - Persist to session ledger via `ledger.logWarning`/`ledger.logFinding`.
   - Aggregate and pass to next wave's `buildAgentConfig` via `opts.previousFindings`.

2. In `buildAgentConfig`, accept `opts.previousFindings`, pass to `analyzeTask` so it lands on `analysis.previousFindings` — the system prompt section at factory.js:604 will render correctly.

3. Bypass agent cache (`opts.skipCache: true`) for wave-to-wave rebuilds so cache key incorporates previous-wave context.

**Acceptance:** integration test spawning two synthetic agents sequentially where the second expects findings from the first to appear in its system prompt. Assert `system_prompt.includes('Previous Agent Findings')` for the second agent.

**Commit:** `fix(orchestrator): propagate agent findings between waves`

---

### Fix 10 — Extend agent cache key

**Severity:** High. Stale agents ship with out-of-date contract.

**File:** `forge-agents/cache.js::computeInputHash`

**Problem:** Current hash only includes plan content + graph.db mtime + system-graph.db mtime + knowledge.json content + ledger.md mtime. Missing:
- `.planning/REQUIREMENTS.md`, `ROADMAP.md`, `PROJECT.md`, `STATE.md`
- `factory.js` mtime (so factory code updates invalidate)
- Previous-wave findings
- Referenced source files (@-references in `<context>`)

**Approach:** Extend to hash:
```js
const planningFiles = ['.planning/REQUIREMENTS.md', '.planning/ROADMAP.md',
                      '.planning/PROJECT.md', '.planning/STATE.md'];
for (const p of planningFiles) {
  try {
    const stat = fs.statSync(path.join(cwd, p));
    hash.update(`${p}_mtime:${stat.mtimeMs}`);
  } catch {
    hash.update(`${p}_mtime:none`);
  }
}

// Factory version (bump this constant when factory logic changes)
const FACTORY_VERSION = 'v2.0';
hash.update(`factory:${FACTORY_VERSION}`);

// Previous-wave findings (if passed via opts)
if (opts?.previousFindings) {
  hash.update(`prev_findings:${JSON.stringify(opts.previousFindings)}`);
}
```

**Acceptance:** unit test confirming that updating `REQUIREMENTS.md` or bumping `FACTORY_VERSION` produces a different hash.

**Commit:** `fix(cache): hash planning docs, factory version, previous findings`

---

### Fix 11 — Patch applier: DAG order, conflict guard, transaction

**Severity:** High. Parallel patches race today.

**Files:** `forge-containers/patch-collector.js`, `worktree-orchestrator.js`

**Problem:** Patches applied in directory-listing order (alphabetical). No DAG ordering, no partial-failure rollback, no file-overlap detection between parallel agents.

**Approach:**

1. **Pre-apply conflict guard:** refuse to run if any two patches in the same wave touch the same file. Parse patch headers, build file-set per patch, assert no intersection. Fail fast with clear error.

2. **DAG-ordered apply:** use the parallel-planner's dependency info. If patch B depends on patch A, apply A first. Alphabetical order is replaced with topological sort.

3. **Wave-level transaction:**
   - Before wave: record `git rev-parse HEAD` as `wave_start_sha`.
   - Apply patches in DAG order.
   - If any patch fails to apply or if post-apply verification (tsc, key_links) fails after fix-loops are exhausted: `git reset --hard wave_start_sha` to restore pre-wave state.

**Acceptance:** integration test with two parallel sub-plans both modifying `src/index.ts`. Expected: patch applier detects conflict before apply, fails the wave cleanly.

**Commit:** `fix(containers): DAG ordering, conflict guard, wave-level rollback on patch apply`

---

### Fix 12 — Bypass cache for revision and fix agents

**Severity:** Low-Medium. Revision agents get cached config without checker issues.

**Files:** `forge-cli/workflows/plan-phase.md` (revision spawn), `forge-cli/workflows/execute-phase.md` (fix-agent spawn)

**Approach:** Pass `opts.skipCache: true` when building revision/fix-agent configs. The plumbing exists at `factory.js:1156-1166`, just needs to be called.

**Acceptance:** integration test — revision agent after plan-checker identifies issues receives a freshly-built config whose system prompt includes the checker's specific issues.

**Commit:** `fix(workflows): bypass agent cache for revision and fix-agent builds`

---

### Fix 13 — Add per-wave code reviewer

**Severity:** Medium. Currently no semantic review between executor and end-of-phase verifier.

**Files:**
- New: `agents/forge-code-reviewer.md`
- Modify: `forge-cli/workflows/execute-phase.md` step 5d
- `forge-cli/bin/lib/core.cjs` (add model registration)

**Approach:**

Create a reviewer agent that, after each wave's patches apply, reads:
- Changed files
- Plan's `must_haves`
- Relevant `key_links` for those files

Returns issues if any artifact is a stub or any link unwired. Orchestrator triggers fix-agent with issues as hints. Cap at 2 review iterations per wave (hard limit to control token cost).

**Model selection:** use the balanced profile (sonnet) by default.

**Acceptance:** inject a stub handler in the simulation project; confirm reviewer flags it before the wave is committed.

**Commit:** `feat(agents): add per-wave code reviewer between executor and phase-end verifier`

---

### Fix 14 — Harden the structured agent-output protocol

**Severity:** Medium. Malformed output silently lost today.

**Files:** `forge-agents/agent-output-schema.js`, `agents/forge-executor.md`, `forge-containers/agent-entrypoint.js`

**Approach:**

1. Add JSON-Schema validation for the agent-output schema (`findings`, `decisions_made`, `files_created`, `files_modified`, `confidence`).
2. Missing/malformed output is logged to ledger as a warning, not silently ignored.
3. Update executor prompt to clearly demonstrate the expected format, emphasizing this is the ONLY channel for cross-wave communication.

**Acceptance:** unit test with malformed agent output — validation catches it, ledger logs warning, containing run does not crash.

**Commit:** `fix(agents): JSON-schema validate agent output, log malformed as warning`

---

### Fix 15 — Define the debug-subagent-prompt template

**Severity:** High. Currently undefined — debugger behavior is non-deterministic.

**Files:** `forge-cli/workflows/diagnose-issues.md`

**Problem:** Line 78 says "fill the debug-subagent-prompt template" but no template is defined anywhere in the codebase.

**Approach:** Write the template literally inside the workflow (same pattern as plan-phase.md's revision_prompt at lines 425-443). Include all placeholders (`{truth}`, `{expected}`, `{actual}`, `{errors}`, `{reproduction}`, `{timeline}`, `{goal}`, `{slug}`) so orchestrator just substitutes values.

**Acceptance:** spawn debug agent twice in separate orchestrator runs; captured input prompts match exactly.

**Commit:** `fix(workflows): define debug-subagent-prompt template literally`

---

### Fix 16 — Plan completion uses integrity check, not SUMMARY existence

**Severity:** Medium. Crash-during-commit corrupts resume.

**Files:** `forge-cli/bin/lib/init.cjs::cmdInitExecutePhase`, `forge-cli/workflows/execute-phase.md` filtering step

**Problem:** `has_summary: true` check passes even if:
- SUMMARY.md exists but commits are missing
- SUMMARY.md is truncated with `## Self-Check: FAILED`
- Commits made but SUMMARY missing (crash before final commit)

**Approach:** Replace with multi-criteria check:
1. SUMMARY.md exists
2. SUMMARY.md contains `## Self-Check: PASSED`
3. All commit hashes in SUMMARY exist in `git log`
4. `tests_failed` frontmatter is `0` (or absent)

If any of 2-4 fails: mark plan as `incomplete_partial`, present user with recovery options (retry / manual repair / delete-and-replan).

**Acceptance:** crash executor mid-execution after one task commit. On retry, detect partial state, offer recovery rather than re-executing.

**Commit:** `fix(init): plan completion requires integrity checks, not just SUMMARY existence`

---

### Fix 17 — Make `forge-auto` actually use the factory pipeline

**Severity:** Critical. Auto mode is the largest functional regression — bypasses factory, graph, must_haves, verification entirely.

**Files:** `forge-auto/dispatcher.js`, `forge-auto/auto.js`, `forge-auto/state-machine.js`

**Problem:** `dispatcher.js::buildPrompt` emits ~1500-token prompts with no factory build, no graph context, no must_haves, no archetype, no verification. The README promises "autonomous execution of the full project workflow" — the implementation is `claude --print` with crash recovery.

**Approach:**

1. **"execute" unit:** route through `forge-agents/factory.js::buildAgentConfig` to produce a proper config. Spawn via container/worktree orchestrator path — same code as execute-phase.md step 5. Apply patches and run full per-wave verification loop.

2. **"plan" unit:** spawn via the planner subagent_type with plan-phase orchestrator's prompt template (extract it into a reusable form).

3. **"verify" unit:** invoke verifier via execute-phase.md step 6 path, with phase context loaded.

4. **Abandon truncate-to-4000-chars approach** — factory handles context budget properly, let it.

5. **Crash recovery restarts at the same wave/agent**, not the entire phase.

**Acceptance:** `/forge-auto` against the simulation project produces artifacts identical (±10% token budget) to manual `/forge-plan-phase 01 → /forge-execute-phase 01 → /forge-verify-work 01`.

**Commit:** `fix(auto): route auto-mode units through factory pipeline, not minimal prompts`

---

### Fix 18 — Research integrity gate

**Severity:** High. Research has no checker equivalent to plan-checker; staleness ignored.

**Files:**
- New: `agents/forge-research-checker.md`
- Modify: `forge-cli/workflows/plan-phase.md` step 5, `new-project.md` after-synthesizer step
- `forge-agents/cache.js` (extend P1.10 hash with `.planning/research/*.md` + `package.json`)

**Approach:**

1. Create `forge-research-checker` agent (mirror of `forge-plan-checker`):
   - Validates RESEARCH.md structure (required sections present).
   - Checks confidence labels are present and meaningful.
   - HIGH-confidence claims must cite Primary source URLs.
   - LOW-confidence claims flagged for explicit user attention.
   - Cross-references files for contradictions (STACK vs ARCHITECTURE; FEATURES vs STACK).
   - Returns `## RESEARCH PASSED` or `## RESEARCH ISSUES FOUND` with structured issues.

2. Add 2-iteration revision loop (fewer than plan-checker's 3 because research is more open-ended):
   - Researcher → checker → if issues, revise → max 2 iterations → on exhaustion offer {Force proceed, Adjust scope, Abort}.

3. **Freshness check** in `plan-phase.md` step 5:
   - Read `Valid until` date from RESEARCH.md YAML frontmatter.
   - If past expiry: require `--use-stale` flag or re-spawn researcher.

4. **Cache invalidation**: include `.planning/research/*.md` and `package.json` in agent cache key (extends Fix 10).

5. **Open Questions surfacing**: `/forge-discuss-phase` reads RESEARCH.md's Open Questions section and seeds `AskUserQuestion` prompts during CONTEXT.md generation.

**Acceptance:** researcher produces contradictory RESEARCH.md (STACK recommends lib X, ARCHITECTURE assumes lib Y); checker flags contradiction; researcher revises; checker passes. A RESEARCH.md with `valid_until: 2024-01-01` triggers re-research prompt today.

**Commit:** `feat(research): add research-checker with 2-iteration revision loop and freshness check`

---

### Phase 1 acceptance

New simulations to add to `tests/requirements-pipeline.test.cjs`:

- **S2 — Multi-wave dependency.** Plan with Wave 2 depending on type from Wave 1. Assert Wave 2's system prompt includes the type signature.
- **S3 — Wave-to-wave finding.** Wave 1 emits finding "API X returns XML, not JSON"; Wave 2 sees it in prompt.
- **S4 — File ownership conflict.** Two parallel sub-plans both modify `src/index.ts`. Assert patch applier refuses before apply.
- **S5 — Stub implementation.** From the baseline; assert engine reports FAIL with specific broken-link diagnoses.
- **Auto-mode equivalence.** `/forge-auto` vs manual sequence produces same artifacts.

**Phase 1 commit tag:** `phase-1-correctness-complete`

---

<a id="phase-2"></a>
## 5. Phase 2 — Test integrity (~3.5 weeks)

**Objective:** break the implementation→test loop. Replace with requirements→test→implementation. After Phase 2, tests are genuine checks on whether requirements are met.

---

### Fix 19 — Generate tests from `must_haves.truths` BEFORE implementation

**Severity:** Critical. This is the single largest correctness defect after the Phase 0 parser bugs.

**Files:**
- New: `agents/forge-test-author.md`
- Modify: `agents/forge-planner.md` (mandatory test task), `forge-cli/references/tdd.md`, `forge-cli/workflows/execute-phase.md` (add test-author wave)

**Problem:** Tests are currently written from the code (planner's mandatory test task says "Test scope: match to what was implemented"; `/forge-add-tests` classifies changed files; executor's auto-fix Rule 1 is ambiguous between fixing code and fixing tests). This produces tautological coverage.

**Approach:**

1. Create `forge-test-author` agent that:
   - Reads `must_haves.truths`, `must_haves.key_links`, `requirements` from the plan.
   - Writes one test per truth (or a single test asserting the truth's effect).
   - Tests fail with "not implemented" against an empty repo — this is intentional.

2. Insert test-author wave BEFORE implementation wave in `execute-phase.md`:
   ```
   Wave 0 (new): test-author writes failing tests from truths
   Wave 1..N: executor writes implementation (tests guide it)
   Final: verifier confirms truths are satisfied and tests pass
   ```

3. Update planner's mandatory test task: remove "match what was implemented" language. Reference truths directly.

**Acceptance:** Plan with truths but no implementation → test-author wave produces failing tests per truth → implementation waves make them pass. Scenario S7.

**Commit:** `feat(agents): generate tests from must_haves.truths before implementation`

---

### Fix 20 — Executor auto-fix Rule 1 must NOT modify tests

**Severity:** High. Closes the escape hatch where "fix the test" is a valid outcome.

**File:** `agents/forge-executor.md` Rule 1 section (~line 106)

**Approach:** Add explicit language:

> **Rule 1 Scope — Implementation only.**
> Rule 1 modifies implementation code only. To modify a test file, raise a `checkpoint:decision` and wait for user approval. Tests written by the test-author wave are the contract — implementation must meet them, not the other way around.

Also update deviation-rules examples to show what "auto-fix" means vs doesn't.

**Acceptance:** inject a failing test with a deliberately-wrong assertion into the simulation. Executor either raises checkpoint (correct) or leaves the test alone and marks the task failed. It must NOT silently rewrite the test.

**Commit:** `fix(executor): Rule 1 scope limited to implementation; test changes require checkpoint`

---

### Fix 21 — Per-wave fast verifier

**Severity:** Medium. Currently verifier runs only at end of phase.

**Files:** `forge-verify/loop.js`, `forge-cli/workflows/execute-phase.md` step 5d

**Approach:** After each wave, run only:
- Layer 1 STRUCTURAL
- Layer 3 INTERFACE_CONTRACTS
- Layer 4.5 KEY_LINKS (new in Fix 6)

Skip TYPE_COMPILE (slow — once at phase end), TESTS (covered by test gate), BEHAVIORAL (end of phase).

Wave with broken wiring fails before next wave starts.

**Acceptance:** remove `fetch` call from FeedbackForm.jsx in simulation; per-wave fast verifier flags the broken key_link before Wave 2 begins.

**Commit:** `feat(verify): per-wave fast verifier for structural + interface + key-links`

---

### Fix 22 — Replace `/forge-add-tests` classifier with truth-driven generator

**Severity:** High. Classifier-based tests map to file contents, not requirements.

**Files:** `forge-cli/workflows/add-tests.md`, `skill-sources/forge-add-tests/SKILL.md`

**Approach:** Workflow reads `must_haves.truths` from PLAN.md. For each truth without a corresponding test, generate one. Falls back to classifier only if `must_haves` absent (legacy plans).

Remove the TDD/E2E/Skip classification language at lines 60-66 of `add-tests.md` — replace with truth-to-test mapping.

**Acceptance:** `/forge-add-tests` on the simulation's Phase 01 produces exactly 7 tests (one per truth in PLAN.md), not N tests classified by file contents.

**Commit:** `feat(workflows): add-tests reads must_haves.truths, not classifies files`

---

### Fix 23 — Concurrent ledger write protection

**Severity:** Low (probability) / High (impact).

**File:** `forge-session/ledger.js`

**Problem:** No file lock. 4 parallel agents × 10 entries each may produce variably < 40 entries due to read-modify-write races.

**Approach:** Use `proper-lockfile` or equivalent file-lock library on writes. Alternatively (simpler): batch agent findings and flush once at end of wave by the orchestrator, not per-agent.

**Acceptance:** 4 parallel agents emit 10 entries each → exactly 40 ledger entries every time across 10 test runs.

**Commit:** `fix(session): file lock or batch-write for concurrent ledger updates`

---

### Fix 24 — Codebase docs actually load (or remove dead documents)

**Severity:** High. 5 of 7 mapper outputs are write-only.

**Files:** `forge-cli/bin/lib/init.cjs::cmdInitPlanPhase`, `cmdInitExecutePhase`

**Problem:** `forge-codebase-mapper` claims plan-phase and execute-phase load CONVENTIONS/STRUCTURE/TESTING/CONCERNS/INTEGRATIONS.md. Grep: nothing reads them.

**Approach (preferred — make documents load):**

Add `codebaseDocsForPhaseType(phaseType)` helper that returns the expected paths per the table in `forge-codebase-mapper.md` lines 23-31. Plan-phase init returns these as `--include codebase`. Execute-phase init same.

**Approach (cheaper — remove dead code):**

Drop the unused 5 mapper outputs. Update `forge-codebase-mapper.md` to remove misleading "consumed by" tables.

Choose based on whether the team values per-phase context loading enough to invest implementation work.

**Acceptance:** running `/forge-plan-phase 03` on a project with codebase docs loads the relevant docs into planner's prompt.

**Commit:** `feat(init): load codebase docs by phase type per mapper's documented contract`

---

### Fix 25 — Research provenance and brownfield refresh

**Severity:** Medium. Auditability gap + staleness blind spot.

**Files:** `agents/forge-requirement-enhancer.md`, `forge-cli/workflows/enhance-requirements.md`, `forge-cli/bin/forge-tools.cjs requirements add`, new workflow `research-refresh.md`

**Approach:**

1. **Provenance in requirement-enhancer output:** add `source_dimension` and `source_confidence` to each finding's YAML. Merge into REQUIREMENTS.md as `## Requirement Provenance` table.

2. **New workflow `/forge-research-refresh`:**
   - Diff existing `.planning/research/*.md` `Valid until` against today.
   - Diff `package.json` against research-time snapshot.
   - Re-spawn stale dimensions only.
   - Archive prior research under `.planning/research/archive/{date}/`.

**Acceptance:**
- `forge-tools.cjs requirements provenance AUTH-07` returns source dimension + confidence.
- `/forge-research-refresh` on 9-month-old project re-spawns only stale dimensions, not all 4.

**Commit:** `feat(research): provenance tracking and brownfield refresh workflow`

---

### Fix 26 — Crash-recovery uses boot time

**Severity:** Medium. PID liveness unreliable across reboots.

**File:** `forge-session/crash-recovery.js::readCrashLock`

**Approach:** Add boot-time check before PID kill probe:

```js
function getBootTime() {
  // Linux: /proc/uptime, macOS: sysctl kern.boottime, Windows: WMI
  // Fallback: Date.now() - os.uptime()
  return Math.floor(Date.now() / 1000) - os.uptime();
}

// In readCrashLock:
const startEpoch = Math.floor(new Date(data.startedAt).getTime() / 1000);
if (startEpoch < getBootTime()) {
  data.processAlive = false;
} else {
  try { process.kill(data.pid, 0); data.processAlive = true; }
  catch { data.processAlive = false; }
}
```

**Acceptance:** unit test mocks system uptime less than lock age; `processAlive` returns false even if PID alive.

**Commit:** `fix(crash-recovery): use boot time to detect pre-reboot locks`

---

### Fix 27 — Context-monitor independence from statusline

**Severity:** Medium. Hook silently dormant during autonomous runs.

**File:** `hooks/forge-context-monitor.js`

**Problem:** Metrics file only written during UI interaction. Long autonomous runs → stale metrics → hook exits → no warning at context exhaustion.

**Approach:** When statusline metrics stale (>60s), fall back to transcript-size estimation from stdin (hook already receives transcript). Less accurate but better than silent exit.

**Acceptance:** long autonomous run with no statusline updates still triggers WARNING and CRITICAL thresholds.

**Commit:** `fix(hooks): context-monitor falls back to transcript estimation when statusline stale`

---

### Phase 2 acceptance

Additional simulations:

- **S6 — Requirement removal.** Passing implementation → remove requirement → rerun verifier. Cache invalidates; verifier reports orphaned implementation.
- **S7 — Test-from-requirements.** Plan with truths but no implementation → test-author produces failing tests → implementation makes them pass.
- **S8 — Auto-fix scope.** Inject failing test; executor must not silently rewrite it.

**Phase 2 commit tag:** `phase-2-test-integrity-complete`

---

<a id="phase-3"></a>
## 6. Phase 3 — Token efficiency (~2 weeks)

**Objective:** ~50% token reduction without losing functionality. Static infrastructure today is ~174K tokens (87% of context window) before any project content.

---

### Fix 28 — Factor cross-agent common vocabulary

**Estimated savings:** ~15K tokens per invocation using 3+ defined terms.

**File:** new `forge-cli/references/common-vocabulary.md`

**Approach:** Define once in the new reference: `must_haves`, `key_links`, `truths`, `requirements`, `CONTEXT.md`, `STATE.md`, `SUMMARY.md`, `Phase Boundary`, `goal-backward`, `frontmatter`, `Locked Decisions`, etc. Strip definitions from every agent prompt; replace with `@common-vocabulary.md` reference.

Important: vocabulary is description-only, not procedural. Each agent retains its own behavior section.

**Acceptance:** `forge-planner.md` drops from 11,147 tokens to ~5K. Functionality tests (simulations S1-S8) continue to pass.

**Commit:** `refactor(references): factor cross-agent common vocabulary`

---

### Fix 29 — Slim the planner prompt

**Estimated savings:** ~6K tokens per planner invocation.

**File:** `agents/forge-planner.md`

**Approach:** Move to new `planner-cookbook.md` reference, loaded only when signals detected:
- 3 worked examples (lines 318-376)
- UI/UX specificity table (lines 220-242) — load only if phase has UI signal
- Depth calibration tables (lines 405-426) — load only for comprehensive depth

Target: 5K tokens for base planner prompt.

**Acceptance:** `/forge-plan-phase` on backend-only phase doesn't load UI specificity content. Token benchmark confirms ≥6K reduction.

**Commit:** `refactor(agents): slim planner prompt, extract worked examples to cookbook`

---

### Fix 30 — Slim verifier and plan-checker prompts

**Estimated savings:** ~6K tokens per phase.

**Files:** `agents/forge-verifier.md`, `agents/forge-plan-checker.md`

**Approach:** Same technique — extract stub-detection patterns and worked examples to `verifier-cookbook.md`. Target: 3K tokens each for base prompts.

**Acceptance:** token benchmark confirms ≥6K reduction; simulation S5 (stub detection) still passes.

**Commit:** `refactor(agents): slim verifier and plan-checker prompts`

---

### Fix 31 — Replace bulk `--include` with summary-then-load

**Estimated savings:** 50-150K tokens per phase on mature projects.

**Files:** `forge-cli/bin/lib/init.cjs::cmdInitPlanPhase`, `cmdInitExecutePhase`

**Problem:** Today `--include state,roadmap,requirements,context,research,verification,uat` inlines full file contents. For a mature project REQUIREMENTS+ROADMAP+CONTEXT can be 20-80K tokens; that is then duplicated across researcher, planner, checker sub-agents (60-240K total just for bulk-load).

**Approach:** Return file path + first-N-lines summary (first 50 lines) + total line count. Sub-agents read full content via the Read tool only when needed. Add `context_insufficient: true` signal in structured output so orchestrator can retry with full content; track rate of these retries — if >5%, increase default summary length.

**Acceptance:** token benchmark on mature project (50K-token REQUIREMENTS.md) shows 50-150K reduction per phase. Functionality tests still pass.

**Commit:** `refactor(init): summary-then-load instead of bulk inclusion`

---

### Fix 32 — Cap ledger inclusion

**Estimated savings:** ~2-10K tokens per agent depending on project age.

**Files:** `forge-agents/factory.js::extractSessionContext`, `composeSystemPrompt`

**Approach:** Cap at last 30 entries per category (decisions, warnings, preferences, rejected). Older entries via `ledger read --since` when agent needs them.

**Acceptance:** 500-entry ledger yields system prompt ≤5K tokens of session context (was unbounded).

**Commit:** `refactor(agents): cap ledger context at 30 entries per category`

---

### Fix 33 — Cache composed system prompt separately

**Estimated savings:** ~5K tokens per non-plan change.

**File:** `forge-agents/factory.js`

**Approach:** Memo composed system prompt against a sub-hash that excludes plan content (so plan-only changes reuse prompt scaffold).

**Acceptance:** changing plan content but not graph/ledger → reuses cached system prompt scaffold, only rebuilds task-prompt portion.

**Commit:** `perf(agents): cache composed system prompt scaffold separately from plan content`

---

### Fix 34 — Switch `general-purpose` agent invocations to proper subagent_type

**Estimated savings:** 16K tokens per `/forge-new-project`, up to 44K per planner revision loop.

**Files:** `forge-cli/workflows/new-project.md` (4 researcher spawns), `plan-phase.md` (initial + revision planner, phase-researcher), `quick.md` (planner), `diagnose-issues.md` (debugger)

**Problem:** 8 invocation sites use `subagent_type="general-purpose"` with `"First, read ~/.claude/agents/forge-X.md"` prepended. Role loads via Read tool into conversation context instead of system message — expensive and weakens agent identity.

**Approach:** Switch all 8 sites to `subagent_type="forge-X"` (the registered name). Pass `model="${X_model}"` where the registration expects it.

**Debugger special case:** Fix 15 (debug template definition) must land first so the debugger receives a well-formed user prompt.

**Acceptance:** `subagent_type="forge-planner"` observed on the wire. Token benchmark on `/forge-new-project` drops ≥15K.

**Commit:** `perf(workflows): use registered subagent_type for all agent invocations`

---

### Fix 35 — Researcher WebSearch budget

**Estimated savings:** 10-30K tokens per research session.

**Files:** `agents/forge-project-researcher.md`, `agents/forge-phase-researcher.md`

**Approach:**

1. Hard cap: 5 WebSearch + 3 WebFetch per research session. More requires explicit orchestrator grant.
2. Encourage Context7 over WebSearch: "WebSearch is most expensive and lowest-trust. Default to Context7. WebFetch when Context7 lacks the library. WebSearch only when both fail."
3. Result summarization: "After each WebSearch, immediately note which URL(s) to fetch and discard the rest from your working summary. Do not retain raw search snippets."

**Acceptance:** `/forge-new-project` that previously consumed ~120K tokens of researcher inference drops to ≤60K total.

**Commit:** `perf(research): WebSearch budget caps + Context7-first tool preference`

---

### Fix 36 — Multi-runtime conversion conformance tests

**Files:** new `tests/install-conversions.test.cjs`

**Approach:** For each of 12 agent prompts × 3 target runtimes (Codex, Opencode, Gemini) = 36 cases. Assert:
- Output non-empty
- Frontmatter parseable as YAML where expected
- `${VAR}` patterns preserved or documented as transformed
- No tag content lost
- Round-trip (Claude→Gemini→Claude) recognizable

**Acceptance:** all 36 test cases pass.

**Commit:** `test(install): conformance tests for multi-runtime conversions`

---

### Phase 3 acceptance

Run S1 end-to-end and capture total tokens consumed across all sub-agent invocations. Acceptance: total tokens reduced by ≥50% vs baseline recorded at start of Phase 3.

**Phase 3 commit tag:** `phase-3-token-efficiency-complete`

---

<a id="7-acceptance-gates"></a>
## 7. Acceptance gates per phase

After each phase commit-tag, the following gates must pass before starting the next phase:

### Gate 0 (after Phase 0)
- Baseline harness B1-B4 all show correct behavior.
- `tests/requirements-pipeline.test.cjs` passes.

### Gate 1 (after Phase 1)
- Simulations S1-S5 pass.
- Auto-mode equivalence test passes.
- No regression in Gate 0.

### Gate 2 (after Phase 2)
- Simulations S6-S8 pass.
- Token benchmark: baseline recorded against S1.
- No regression in Gates 0-1.

### Gate 3 (after Phase 3)
- Token benchmark shows ≥50% reduction vs Gate 2 baseline.
- No regression in Gates 0-2.
- All multi-runtime conversion tests pass.

If a gate fails, do not advance. Diagnose, fix, re-run gate.

---

<a id="8-traceability"></a>
## 8. Findings → fix traceability matrix

| # | Finding | Severity | Fix | Phase |
|---|---------|----------|-----|-------|
| F1 | parsePlan drops frontmatter fields | Critical | Fix 1 | 0 |
| F2 | `<task>` regex, `<objective>` tag | Critical | Fix 2 | 0 |
| F3 | Subplan strips contract | Critical | Fix 4 | 0 |
| F4 | System prompt no contract | Critical | Fix 5 | 0 |
| F5 | must_haves indent rigid | Critical | Fix 1 | 0 |
| F6 | Key-link false positive | Critical | Fix 3 | 0 |
| F7 | Engine no key-links layer | Critical | Fix 6 | 0 |
| F8 | Tests from implementation | Critical | Fix 19, 20, 22 | 2 |
| F9 | Findings not propagated | High | Fix 9 | 1 |
| F10 | Cache key incomplete | High | Fix 10 | 1 |
| F11 | Patch race | High | Fix 11 | 1 |
| F12 | add-tests classifier | High | Fix 22 | 2 |
| F13 | Token bloat | High | Fix 28-33, 35 | 3 |
| F14 | No executor reviewer | Medium | Fix 13 | 1 |
| F15 | Verifier end of phase | Medium | Fix 21 | 2 |
| F16 | Splitter pollution | Medium | Fix 8 | 0 |
| F17 | must_check trivial | Medium | Fix 7 | 0 |
| F18 | Revision cache | Low | Fix 12 | 1 |
| F19 | Ledger race | Low | Fix 23 | 2 |
| F20 | Research staleness | High | Fix 18 | 1 |
| F21 | No research checker | High | Fix 18 | 1 |
| F22 | general-purpose role | High | Fix 34 | 3 |
| F23 | No brownfield refresh | Medium | Fix 25 | 2 |
| F24 | WebSearch bloat | Medium | Fix 35 | 3 |
| F25 | Synthesizer concat | Medium | Fix 18 | 1 |
| F26 | No provenance | Medium | Fix 25 | 2 |
| F27 | Open questions ignored | Low-Medium | Fix 18, 25 | 1, 2 |
| F28 | Research not invalidated | Low | Fix 18 | 1 |
| F29 | Auto bypass factory | Critical | Fix 17 | 1 |
| F30 | Codebase write-only | High | Fix 24 | 2 |
| F31 | Debug template undef | High | Fix 15 | 1 |
| F32 | Debugger general-purpose | High | Fix 34 | 3 |
| F33 | `<n>` vs `<name>` regex | Critical | Section 0 correction | 0 |
| F34 | PID liveness | Medium | Fix 26 | 2 |
| F35 | Idempotency | Medium | Fix 16 | 1 |
| F36 | Context-monitor | Medium | Fix 27 | 2 |
| F37 | Install conversions | Medium | Fix 36 | 3 |

**37 findings → 36 fixes + 1 self-correction.** Some fixes close multiple findings.

---

<a id="9-appendices"></a>
## 9. Appendices

<a id="appendix-a"></a>
### Appendix A — Spec-compliant PLAN.md for the simulation

Write this verbatim to `.planning/phases/01-feedback-form/01-01-PLAN.md`:

```markdown
---
phase: 01-feedback-form
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/FeedbackButton.jsx
  - src/components/FeedbackForm.jsx
  - src/components/Layout.jsx
  - src/api/feedback/route.js
  - src/lib/db.js
autonomous: true
requirements:
  - FB-01
  - FB-02
  - FB-03
  - FB-04
  - FB-05
has_tests: true
must_haves:
  truths:
    - "User can click a 'Send feedback' button in the layout header"
    - "User can type a message between 1 and 500 characters"
    - "User can optionally type an email"
    - "Submitting the form sends a POST to /api/feedback"
    - "The submitted record is stored in the database"
    - "On success, a confirmation toast appears and the form clears"
    - "On failure, an inline error appears and the input is preserved"
  artifacts:
    - path: src/components/FeedbackButton.jsx
      provides: Header button that opens the feedback form
      min_lines: 8
      contains: Send feedback
    - path: src/components/FeedbackForm.jsx
      provides: Form with message + optional email, submit handler
      min_lines: 30
      contains: onSubmit
    - path: src/components/Layout.jsx
      provides: Layout that mounts FeedbackButton in the header
      contains: FeedbackButton
    - path: src/api/feedback/route.js
      provides: POST handler that validates and stores feedback
      min_lines: 15
      contains: insertFeedback
    - path: src/lib/db.js
      provides: insertFeedback / listFeedback already exist; reused here
      contains: insertFeedback
  key_links:
    - from: src/components/Layout.jsx
      to: src/components/FeedbackButton.jsx
      via: import + JSX usage in header
      pattern: FeedbackButton
    - from: src/components/FeedbackButton.jsx
      to: src/components/FeedbackForm.jsx
      via: renders FeedbackForm when open
      pattern: FeedbackForm
    - from: src/components/FeedbackForm.jsx
      to: src/api/feedback/route.js
      via: fetch POST in onSubmit
      pattern: "fetch\\(['\"]/api/feedback"
    - from: src/api/feedback/route.js
      to: src/lib/db.js
      via: import + call insertFeedback
      pattern: "insertFeedback\\("
---

<objective>
Add a user feedback form that opens from a header button and persists
submissions via a new POST /api/feedback endpoint.
</objective>

<context>
@.planning/REQUIREMENTS.md
@src/components/Layout.jsx
@src/lib/db.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create FeedbackButton + FeedbackForm</name>
  <files>src/components/FeedbackButton.jsx, src/components/FeedbackForm.jsx</files>
  <action>
Create FeedbackButton.jsx: button labelled "Send feedback" that toggles boolean state and conditionally renders FeedbackForm.
Create FeedbackForm.jsx: form with textarea (message 1-500 required) and email input (optional, basic email regex). On submit, fetch('/api/feedback', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({message,email}) }). If response.ok: show toast, reset form. If !response.ok: show inline error "Could not send - try again" and PRESERVE inputs.
  </action>
  <verify>Form has onSubmit that calls fetch to /api/feedback. Success resets; failure preserves.</verify>
  <done>Both components exist, submits via fetch, success/failure paths handled.</done>
</task>

<task type="auto">
  <name>Task 2: Wire FeedbackButton into Layout header</name>
  <files>src/components/Layout.jsx</files>
  <action>Import FeedbackButton from './FeedbackButton' and render inside &lt;header&gt; alongside &lt;h1&gt;.</action>
  <verify>Layout imports and renders FeedbackButton.</verify>
  <done>Header shows the feedback button.</done>
</task>

<task type="auto">
  <name>Task 3: Create POST /api/feedback route</name>
  <files>src/api/feedback/route.js</files>
  <action>Create POST handler. Parse JSON. Validate: message string 1-500, email (if present) matches basic regex. 400 on invalid. 201 + inserted row on valid. Call insertFeedback from '../../lib/db.js'.</action>
  <verify>Valid body → 201. Invalid → 400. Record appears in store.</verify>
  <done>Route exists, validates, calls insertFeedback, returns proper codes.</done>
</task>

<task type="auto">
  <name>Task 4: Add tests</name>
  <files>src/components/FeedbackForm.test.js, src/api/feedback/route.test.js</files>
  <action>Component test: render form, type message, mock fetch to resolve ok, submit, assert cleared. API test: import POST, build Request with valid JSON, assert 201 and listFeedback() length increased.</action>
  <verify>npm test passes</verify>
  <done>All new tests pass.</done>
</task>

</tasks>

<verification>
E2E: open app, click "Send feedback" header, type message, submit, see toast and cleared form. Verify db store contains row.
</verification>

<success_criteria>
All 5 requirements (FB-01..FB-05) satisfied with verifiable wiring button → form → POST → db.
</success_criteria>
```

---

<a id="appendix-b"></a>
### Appendix B — Deliberately-broken stub implementation

Use for baseline harness and regression tests — these pass naive checks but break the requirements:

`src/components/Layout.jsx`:
```jsx
import { FeedbackButton } from './FeedbackButton.jsx';
// Imported but never rendered — orphan import.
export function Layout({ children }) {
  return (
    <div className="layout">
      <header><h1>Sim App</h1></header>
      <main>{children}</main>
    </div>
  );
}
```

`src/components/FeedbackButton.jsx`:
```jsx
import { useState } from 'react';
// Button exists but doesn't render the form — broken wiring.
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(!open)}>Send feedback</button>;
}
```

`src/components/FeedbackForm.jsx`:
```jsx
import { useState } from 'react';
// Form exists but onSubmit only does e.preventDefault — no fetch call.
export function FeedbackForm() {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} required />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Send</button>
    </form>
  );
}
```

`src/api/feedback/route.js`:
```js
// Route exists but ignores body and never stores anything — orphan endpoint.
export async function POST(req) {
  return new Response(JSON.stringify({ message: 'received' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
```

---

<a id="appendix-c"></a>
### Appendix C — Correct reference implementation

Use in Phase 2 Fix 19 acceptance and Fix 21 per-wave verifier test, and as a passing-state in the regression test. These files satisfy every truth and key_link:

`src/components/FeedbackButton.jsx`:
```jsx
import { useState } from 'react';
import { FeedbackForm } from './FeedbackForm.jsx';
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Send feedback</button>
      {open && <FeedbackForm onClose={() => setOpen(false)} />}
    </>
  );
}
```

`src/components/FeedbackForm.jsx`:
```jsx
import { useState } from 'react';
export function FeedbackForm({ onClose }) {
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, email: email || undefined }),
      });
      if (!res.ok) { setError('Could not send - try again'); return; }
      setToast('Thanks for your feedback!');
      setMessage(''); setEmail('');
    } catch { setError('Could not send - try again'); }
  }
  return (
    <form onSubmit={onSubmit}>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} required minLength={1} />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Send</button>
      {error && <div role="alert">{error}</div>}
      {toast && <div role="status">{toast}</div>}
      <button type="button" onClick={onClose}>Close</button>
    </form>
  );
}
```

`src/components/Layout.jsx`:
```jsx
import { FeedbackButton } from './FeedbackButton.jsx';
export function Layout({ children }) {
  return (
    <div className="layout">
      <header>
        <h1>Sim App</h1>
        <FeedbackButton />
      </header>
      <main>{children}</main>
    </div>
  );
}
```

`src/api/feedback/route.js`:
```js
import { insertFeedback } from '../../lib/db.js';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function POST(req) {
  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'invalid JSON' }), { status: 400, headers: { 'content-type': 'application/json' } }); }
  const { message, email } = body || {};
  if (typeof message !== 'string' || message.length < 1 || message.length > 500) {
    return new Response(JSON.stringify({ error: 'message must be 1-500 chars' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  if (email != null && (typeof email !== 'string' || !EMAIL_RE.test(email))) {
    return new Response(JSON.stringify({ error: 'invalid email' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const row = insertFeedback({ message, email: email || null });
  return new Response(JSON.stringify(row), { status: 201, headers: { 'content-type': 'application/json' } });
}
```

---

<a id="appendix-d"></a>
### Appendix D — Phase budget summary

| Phase | Fixes | Estimated effort |
|-------|-------|------------------|
| **Phase 0** (Foundation) | 1-8 | ~1 week |
| **Phase 1** (Correctness) | 9-18 | ~3 weeks |
| **Phase 2** (Test integrity) | 19-27 | ~3.5 weeks |
| **Phase 3** (Token efficiency) | 28-36 | ~2 weeks |
| **TOTAL** | 36 fixes + 1 correction | **~9.5 weeks** |

This is focused single-developer time. Actual calendar time will depend on review cycles, testing thoroughness, and parallel work.

---

<a id="appendix-e"></a>
### Appendix E — Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Fix 19 (test-author wave) doubles execution time | High | Medium | Run in parallel with first implementation wave where possible; cap 1 test per truth; opt-out via `must_haves.truths_skip_tdd: true` |
| Fix 28 (common vocabulary) over-abstracts | Medium | Low | Vocabulary is description-only; procedural content stays in individual agents |
| Fix 31 (summary-then-load) loses context | Medium | Medium | `context_insufficient: true` signal triggers full-content retry; track rate — if >5%, expand summary length |
| Fix 13 (per-wave reviewer) infinite loops | Medium | High | Hard cap 2 iterations per wave; escalate to user checkpoint:decision |
| New `yaml` npm dep breaks airgapped install | Medium | Medium | Vendor into `vendor/`; document in CONTRIBUTING.md |
| Fix 17 (auto mode rewrite) regresses crash recovery | Medium | High | Extensive test harness before merge; preserve crash-lock protocol |

---

<a id="appendix-f"></a>
### Appendix F — Out of audit scope (future passes)

These were not audited in the current pass and are flagged for future work:

- Long-running execution: STATE.md / ledger.md unbounded growth.
- Partial container failure recovery: orphan containers/worktrees after Docker kill mid-wave.
- Permissions/ownership edge cases: restricted git perms, read-only `.forge/`.
- Encoding edge cases: non-ASCII in plans, spaces/special chars in file paths.
- Resource exhaustion: 8 parallel agents × 2GB when container limit estimator misjudged.
- Git LFS / submodule / monorepo behavior.
- `forge-system` / `forge-analyze` cross-repo subsystems (optional, unaudited).
- `forge-roadmapper` agent (uses proper subagent_type, no obvious defects in quick scan; deeper audit not performed).

---

## End of document

For any fix, if the acceptance command fails, **stop and diagnose**. Do not adjust the acceptance check to pass. Do not bundle fixes into one commit. Do not refactor outside declared scope. Escalate to a human when unsure.

This document is the definitive remediation plan; other fix docs in the repo may be outdated. If a discrepancy arises between this document and the individual audit docs (`FORGE_FIXING_PLAN.md`, `FORGE_VALIDATION_PLAN.md`, addenda), **this document wins**.
