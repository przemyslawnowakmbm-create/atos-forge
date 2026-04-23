# Verifier Cookbook

Reference material for `forge-verifier` and `forge-plan-checker`. Contains stub-detection patterns, wiring red flags, worked examples of verification issues, and anti-pattern catalogs.

---

## Stub Detection Patterns (forge-verifier)

### React Component Stubs

```javascript
// RED FLAGS:
return <div>Component</div>
return <div>Placeholder</div>
return <div>{/* TODO */}</div>
return null
return <></>

// Empty handlers:
onClick={() => {}}
onChange={() => console.log('clicked')}
onSubmit={(e) => e.preventDefault()}  // Only prevents default
```

### API Route Stubs

```typescript
// RED FLAGS:
export async function POST() {
  return Response.json({ message: "Not implemented" });
}

export async function GET() {
  return Response.json([]); // Empty array with no DB query
}
```

### Wiring Red Flags

```typescript
// Fetch exists but response ignored:
fetch('/api/messages')  // No await, no .then, no assignment

// Query exists but result not returned:
await prisma.message.findMany()
return Response.json({ ok: true })  // Returns static, not query result

// Handler only prevents default:
onSubmit={(e) => e.preventDefault()}

// State exists but not rendered:
const [messages, setMessages] = useState([])
return <div>No messages</div>  // Always shows "no messages"
```

---

## Wiring Verification Patterns (forge-verifier)

### Pattern: Component → API

```bash
grep -E "fetch\(['\"].*$api_path|axios\.(get|post).*$api_path" "$component" 2>/dev/null
grep -A 5 "fetch\|axios" "$component" | grep -E "await|\.then|setData|setState" 2>/dev/null
```

Status: WIRED (call + response handling) | PARTIAL (call, no response use) | NOT_WIRED (no call)

### Pattern: API → Database

```bash
grep -E "prisma\.$model|db\.$model|$model\.(find|create|update|delete)" "$route" 2>/dev/null
grep -E "return.*json.*\w+|res\.json\(\w+" "$route" 2>/dev/null
```

Status: WIRED (query + result returned) | PARTIAL (query, static return) | NOT_WIRED (no query)

### Pattern: Form → Handler

```bash
grep -E "onSubmit=\{|handleSubmit" "$component" 2>/dev/null
grep -A 10 "onSubmit.*=" "$component" | grep -E "fetch|axios|mutate|dispatch" 2>/dev/null
```

Status: WIRED (handler + API call) | STUB (only logs/preventDefault) | NOT_WIRED (no handler)

### Pattern: State → Render

```bash
grep -E "useState.*$state_var|\[$state_var," "$component" 2>/dev/null
grep -E "\{.*$state_var.*\}|\{$state_var\." "$component" 2>/dev/null
```

Status: WIRED (state displayed) | NOT_WIRED (state exists, not rendered)

---

## Artifact Status Decision Matrix (forge-verifier)

### Three-Level Check

| Exists | Substantive | Wired | Status |
| ------ | ----------- | ----- | ------ |
| ✓ | ✓ | ✓ | ✓ VERIFIED |
| ✓ | ✓ | ✗ | ⚠️ ORPHANED |
| ✓ | ✗ | - | ✗ STUB |
| ✗ | - | - | ✗ MISSING |

### Artifact Tool Result Mapping

| exists | issues empty | Status |
| ------ | ------------ | ------ |
| true | true | ✓ VERIFIED |
| true | false | ✗ STUB |
| false | - | ✗ MISSING |

---

## Anti-Pattern Scan Commands (forge-verifier)

```bash
# TODO/FIXME/placeholder comments
grep -n -E "TODO|FIXME|XXX|HACK|PLACEHOLDER" "$file" 2>/dev/null
grep -n -E "placeholder|coming soon|will be here" "$file" -i 2>/dev/null
# Empty implementations
grep -n -E "return null|return \{\}|return \[\]|=> \{\}" "$file" 2>/dev/null
# Console.log only implementations
grep -n -B 2 -A 2 "console\.log" "$file" 2>/dev/null | grep -E "^\s*(const|function|=>)"
```

Categorize: 🛑 Blocker (prevents goal) | ⚠️ Warning (incomplete) | ℹ️ Info (notable)

---

## UI/UX Anti-Pattern Checks (forge-verifier)

```bash
# Missing alt text on images
grep -n "<img" "$file" | grep -v "alt=" 2>/dev/null
# Icon-only buttons without aria-label
grep -n "<button" "$file" | grep -v "aria-label" | grep -v ">[^<]*[a-zA-Z]" 2>/dev/null
# Form inputs without labels
grep -n "<input\|<textarea\|<select" "$file" | grep -v "aria-label\|id=" 2>/dev/null
# Missing focus indicators
grep -n "onClick\|onPress\|href=" "$file" | grep -v "focus:" 2>/dev/null
# Raw hex/rgb colors in component (should use tokens)
grep -n "#[0-9a-fA-F]\{3,8\}\|rgb(" "$file" | grep -v "\.css\|\.scss\|tokens\|variables\|theme" 2>/dev/null
# Magic number spacing (not on 4/8px grid)
grep -n -E "p-[13579]|m-[13579]|gap-[13579]" "$file" 2>/dev/null
# Emoji used as icons
grep -n -P "[\x{1F300}-\x{1F9FF}]" "$file" 2>/dev/null
# Animations without reduced-motion
grep -n "transition\|animate-\|keyframes" "$file" | grep -v "motion-reduce\|prefers-reduced-motion" 2>/dev/null
```

UI/UX Severity:
- 🛑 **Blocker:** Missing alt text, no keyboard access, form inputs without labels
- ⚠️ **Warning:** Raw hex colors, missing hover states, emoji as icons, magic spacing
- ℹ️ **Info:** Missing reduced-motion (if no animations exist)

---

## Worked Example: Scope Exceeded (forge-plan-checker)

**Plan 01 analysis:**
```
Tasks: 5
Files modified: 12
  - prisma/schema.prisma
  - src/app/api/auth/login/route.ts
  - src/app/api/auth/logout/route.ts
  - src/app/api/auth/refresh/route.ts
  - src/middleware.ts
  - src/lib/auth.ts
  - src/lib/jwt.ts
  - src/components/LoginForm.tsx
  - src/components/LogoutButton.tsx
  - src/app/login/page.tsx
  - src/app/dashboard/page.tsx
  - src/types/auth.ts
```

5 tasks exceeds 2-3 target, 12 files is high, auth is complex domain → quality degradation risk.

```yaml
issue:
  dimension: scope_sanity
  severity: blocker
  description: "Plan 01 has 5 tasks with 12 files - exceeds context budget"
  plan: "01"
  metrics:
    tasks: 5
    files: 12
    estimated_context: "~80%"
  fix_hint: "Split into: 01 (schema + API), 02 (middleware + lib), 03 (UI components)"
```

---

## Worked Example: Issue Formats by Dimension (forge-plan-checker)

### Requirement Coverage (blocker)
```yaml
issue:
  dimension: requirement_coverage
  severity: blocker
  description: "AUTH-02 (logout) has no covering task"
  plan: "16-01"
  fix_hint: "Add task for logout endpoint in plan 01 or new plan"
```

### Task Completeness (blocker)
```yaml
issue:
  dimension: task_completeness
  severity: blocker
  description: "Task 2 missing <verify> element"
  plan: "16-01"
  task: 2
  fix_hint: "Add verification command for build output"
```

### Dependency Correctness (blocker)
```yaml
issue:
  dimension: dependency_correctness
  severity: blocker
  description: "Circular dependency between plans 02 and 03"
  plans: ["02", "03"]
  fix_hint: "Plan 02 depends on 03, but 03 depends on 02"
```

### Key Links (warning)
```yaml
issue:
  dimension: key_links_planned
  severity: warning
  description: "Chat.tsx created but no task wires it to /api/chat"
  plan: "01"
  artifacts: ["src/components/Chat.tsx", "src/app/api/chat/route.ts"]
  fix_hint: "Add fetch call in Chat.tsx action or create wiring task"
```

### Verification Derivation (warning)
```yaml
issue:
  dimension: verification_derivation
  severity: warning
  description: "Plan 02 must_haves.truths are implementation-focused"
  plan: "02"
  problematic_truths:
    - "JWT library installed"
    - "Prisma schema updated"
  fix_hint: "Reframe as user-observable: 'User can log in', 'Session persists'"
```

### Context Compliance — Contradiction (blocker)
```yaml
issue:
  dimension: context_compliance
  severity: blocker
  description: "Plan contradicts locked decision: user specified 'card layout' but Task 2 implements 'table layout'"
  plan: "01"
  task: 2
  user_decision: "Layout: Cards (from Decisions section)"
  plan_action: "Create DataTable component with rows..."
  fix_hint: "Change Task 2 to implement card-based layout per user decision"
```

### Context Compliance — Scope Creep (blocker)
```yaml
issue:
  dimension: context_compliance
  severity: blocker
  description: "Plan includes deferred idea: 'search functionality' was explicitly deferred"
  plan: "02"
  task: 1
  deferred_idea: "Search/filtering (Deferred Ideas section)"
  fix_hint: "Remove search task - belongs in future phase per user decision"
```

### Architectural Fitness (suggestion)
```yaml
issue:
  dimension: architectural_fitness
  severity: suggestion
  description: "Plan creates src/utils/authHelper.ts but CONVENTIONS.md specifies kebab-case for utility files"
  plan: "01"
  task: 2
  convention: "File naming: kebab-case for all files (CONVENTIONS.md)"
  fix_hint: "Rename to src/utils/auth-helper.ts"
```

### Test Coverage (blocker)
```yaml
issue:
  dimension: test_coverage
  severity: blocker
  description: "Plan 01 creates API endpoint src/api/billing/route.ts but has no test task"
  plan: "01"
  testable_files: ["src/api/billing/route.ts", "src/lib/billing.ts"]
  fix_hint: "Add test task creating src/api/billing/route.test.ts and src/lib/billing.test.ts"
```

---

## Scope Thresholds Reference (forge-plan-checker)

| Metric | Target | Warning | Blocker |
|--------|--------|---------|---------|
| Tasks/plan | 2-3 | 4 | 5+ |
| Files/plan | 5-8 | 10 | 15+ |
| Total context | ~50% | ~70% | 80%+ |

---

## Severity Levels Reference (forge-plan-checker)

| Level | Meaning | Examples |
|-------|---------|---------|
| blocker | Must fix before execution | Missing requirement coverage, missing required task fields, circular dependencies, scope > 5 tasks/plan |
| warning | Should fix, execution may work | Scope 4 tasks, implementation-focused truths, minor wiring missing |
| info/suggestion | Suggestions for improvement | Could split for better parallelization, could improve verification specificity, naming convention suggestions |

---

## Test Classification by Source File Type (forge-verifier)

| Source File | Has Test? | Classification |
|-------------|-----------|----------------|
| Business logic / API / exported fn | Required | testable |
| UI component | Recommended | testable |
| Config / migration / types / glue | Not required | exempt |

Test-exempt file types: `.env`, `*.config.*`, `*.json` (non-source), `migrations/`, `schema.*`, `*.d.ts`, `seeds/`, `scripts/`

---

## Requirement Mapping Table Format (forge-plan-checker)

```
Requirement          | Plans | Tasks | Status
---------------------|-------|-------|--------
User can log in      | 01    | 1,2   | COVERED
User can log out     | -     | -     | MISSING
Session persists     | 01    | 3     | COVERED
```
