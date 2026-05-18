<purpose>
Extract implementation decisions that downstream agents need. Analyze the phase to identify gray areas, let the user choose what to discuss, then deep-dive each selected area until satisfied.

You are a thinking partner, not an interviewer. The user is the visionary — you are the builder. Your job is to capture decisions that will guide research and planning, not to figure out implementation yourself.
</purpose>

<downstream_awareness>
**CONTEXT.md feeds into:**

1. **forge-phase-researcher** — Reads CONTEXT.md to know WHAT to research
   - "User wants card-based layout" → researcher investigates card component patterns
   - "Infinite scroll decided" → researcher looks into virtualization libraries

2. **forge-planner** — Reads CONTEXT.md to know WHAT decisions are locked
   - "Pull-to-refresh on mobile" → planner includes that in task specs
   - "Claude's Discretion: loading skeleton" → planner can decide approach

**Your job:** Capture decisions clearly enough that downstream agents can act on them without asking the user again.

**Not your job:** Figure out HOW to implement. That's what research and planning do with the decisions you capture.
</downstream_awareness>

<philosophy>
**User = founder/visionary. Claude = builder.**

The user knows:
- How they imagine it working
- What it should look/feel like
- What's essential vs nice-to-have
- Specific behaviors or references they have in mind

The user doesn't know (and shouldn't be asked):
- Codebase patterns (researcher reads the code)
- Technical risks (researcher identifies these)
- Implementation approach (planner figures this out)
- Success metrics (inferred from the work)

Ask about vision and implementation choices. Capture decisions for downstream agents.
</philosophy>

<scope_guardrail>
**CRITICAL: No scope creep.**

The phase boundary comes from ROADMAP.md and is FIXED. Discussion clarifies HOW to implement what's scoped, never WHETHER to add new capabilities.

**Allowed (clarifying ambiguity):**
- "How should posts be displayed?" (layout, density, info shown)
- "What happens on empty state?" (within the feature)
- "Pull to refresh or manual?" (behavior choice)

**Not allowed (scope creep):**
- "Should we also add comments?" (new capability)
- "What about search/filtering?" (new capability)
- "Maybe include bookmarking?" (new capability)

**The heuristic:** Does this clarify how we implement what's already in the phase, or does it add a new capability that could be its own phase?

**When user suggests scope creep:**
```
"[Feature X] would be a new capability — that's its own phase.
Want me to note it for the roadmap backlog?

For now, let's focus on [phase domain]."
```

Capture the idea in a "Deferred Ideas" section. Don't lose it, don't act on it.
</scope_guardrail>

<gray_area_identification>
Gray areas are **implementation decisions the user cares about** — things that could go multiple ways and would change the result.

**How to identify gray areas:**

1. **Read the phase goal** from ROADMAP.md
2. **Understand the domain** — What kind of thing is being built?
   - Something users SEE → visual presentation, interactions, states matter
   - Something users CALL → interface contracts, responses, errors matter
   - Something users RUN → invocation, output, behavior modes matter
   - Something users READ → structure, tone, depth, flow matter
   - Something being ORGANIZED → criteria, grouping, handling exceptions matter
3. **Generate phase-specific gray areas** — Not generic categories, but concrete decisions for THIS phase

**Don't use generic category labels** (UI, UX, Behavior). Generate specific gray areas:

```
Phase: "User authentication"
→ Session handling, Error responses, Recovery flow, Multi-device policy, Credential storage

Phase: "Organize photo library"
→ Grouping criteria, Duplicate handling, Naming convention

Phase: "CLI for database backups"
→ Output format, Progress reporting

Phase: "API documentation"
→ Structure/navigation, Code examples depth, Versioning approach, Interactive elements
```

**The key question:** What decisions would change the outcome that the user should weigh in on?

**Claude handles these (don't ask):**
- Technical implementation details
- Architecture patterns
- Performance optimization
- Scope (roadmap defines this)
</gray_area_identification>

<process>

<step name="initialize" priority="first">
Phase number from argument (required).

```bash
INIT=$(node ~/.claude/forge-cli/bin/forge-tools.cjs init phase-op "${PHASE}")
```

Parse JSON for: `commit_docs`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `has_research`, `has_context`, `has_plans`, `has_verification`, `plan_count`, `roadmap_exists`, `planning_exists`.

**If `phase_found` is false:**
```
Phase [X] not found in roadmap.

Use /forge-progress to see available phases.
```
Exit workflow.

**If `phase_found` is true:** Continue to check_existing.
</step>

<step name="check_existing">
Check if CONTEXT.md already exists using `has_context` from init.

```bash
ls ${phase_dir}/*-CONTEXT.md 2>/dev/null
```

**If exists:**
Use AskUserQuestion:
- header: "Context"
- question: "Phase [X] already has context. What do you want to do?"
- options:
  - "Update it" — Review and revise existing context
  - "View it" — Show me what's there
  - "Skip" — Use existing context as-is

If "Update": Load existing, continue to analyze_phase
If "View": Display CONTEXT.md, then offer update/skip
If "Skip": Exit workflow

**If doesn't exist:**

Check `has_plans` and `plan_count` from init. **If `has_plans` is true:**

Use AskUserQuestion:
- header: "Plans exist"
- question: "Phase [X] already has {plan_count} plan(s) created without user context. Your decisions here won't affect existing plans unless you replan."
- options:
  - "Continue and replan after" — Capture context, then run /forge-plan-phase {X} to replan
  - "View existing plans" — Show plans before deciding
  - "Cancel" — Skip discuss-phase

If "Continue and replan after": Continue to analyze_phase.
If "View existing plans": Display plan files, then offer "Continue" / "Cancel".
If "Cancel": Exit workflow.

**If `has_plans` is false:** Continue to analyze_phase.
</step>

<step name="analyze_phase">
Analyze the phase to identify gray areas worth discussing.

**Before identifying gray areas, load upstream decisions:**

1. Read `.planning/PROJECT.md` — extract key decisions, constraints, user preferences
2. Read `.planning/REQUIREMENTS.md` — extract requirements mapped to this phase
   (match phase number in traceability table, or REQ-IDs listed in ROADMAP.md phase section)
3. Read phase research if it exists: `${phase_dir}/*-RESEARCH.md`

```bash
cat .planning/PROJECT.md 2>/dev/null
cat .planning/REQUIREMENTS.md 2>/dev/null
cat ${phase_dir}/*-RESEARCH.md 2>/dev/null
```

Collect all decisions, constraints, and specifics from these documents that relate to this phase.

**Read the phase description from ROADMAP.md and determine:**

1. **Domain boundary** — What capability is this phase delivering? State it clearly.

2. **Pre-answered decisions** — Which potential gray areas are already answered by upstream documents?
   For each, note the source (e.g., "REQ-007 specifies card layout", "PROJECT.md constrains to REST API").

3. **Remaining gray areas** — Only ambiguities NOT resolved by upstream docs. For each relevant category (UI, UX, Behavior, Empty States, Content), identify specific ambiguities that would change implementation.

4. **Skip assessment** — If upstream docs + roadmap leave no meaningful gray areas (pure infrastructure, fully specified requirements), the phase may not need discussion.

**Output your analysis internally, then present to user.**

Example analysis for "Post Feed" phase:
```
Domain: Displaying posts from followed users

Pre-answered (from upstream docs):
- Layout: Card-based (REQ-007 specifies cards)
- Loading: Infinite scroll (REQ-007 acceptance criteria)

Remaining gray areas:
- UI: Information density (full posts vs previews)
- Empty State: What shows when no posts exist
- Content: What metadata displays (time, author, reactions count)
```
</step>

<step name="present_gray_areas">
Present the domain boundary and gray areas to user.

**First, state the boundary and pre-answered decisions:**
```
Phase [X]: [Name]
Domain: [What this phase delivers — from your analysis]

Already decided (from requirements/project docs):
- [Decision 1] (source: REQ-XXX / PROJECT.md)
- [Decision 2] (source: REQ-YYY)

[If no pre-answered decisions: omit this section]

Let's clarify what's still open.
(New capabilities belong in other phases.)
```

**Generate the gray-area list (no upper bound):**
- Generate as many **phase-specific** gray areas as the phase actually needs.
  Typical range is 2-8, but it can go higher for rich domains — do not pad,
  and do not cut to hit a fixed number. Each formatted as:
  - "[Specific area]" (label) — concrete, not generic
  - [1-2 questions this covers] (description)
- **Do NOT include a "skip" or "you decide" option.** User ran this command to
  discuss — give them real choices.

**Pick the picker shape based on N (= number of gray areas):**

- If `N <= 4`: single AskUserQuestion (`multiSelect: true`, `header: "Discuss"`,
  question: "Which areas do you want to discuss for [phase name]?", options: the
  N areas). Skip the overview step below.

- If `N > 4`: use the **paginated picker pattern** described in
  `@~/.claude/forge-cli/references/paginated-picker.md` so no AskUserQuestion call
  exceeds the platform cap. Concretely:

  1. Print a numbered overview of every area as plain text so the user sees the
     full landscape before clicking:
     ```
     I see N gray areas worth discussing for Phase [X]:
       1. [Area 1] — [description]
       2. [Area 2] — [description]
       ...
       N. [Area N] — [description]

     I'll show them in pages of 3. Pick what you want, then "Show more areas →"
     to advance. Selections accumulate across pages.
     ```

  2. Compute pages deterministically:
     ```bash
     OPTIONS_JSON='[{"label":"...","description":"..."}, ...]'   # the N areas
     node ~/.claude/forge-cli/bin/forge-tools.cjs picker paginate \
       --options "$OPTIONS_JSON" \
       --nav-label "Show more areas →" \
       --nav-description "Show more gray areas to choose from"
     ```
     The output's `pages[]` is the AskUserQuestion call schedule.

  3. For each page (in order), call AskUserQuestion with:
     - `header: "Discuss"` (same on every page — never append page numbers)
     - `question: "Which areas do you want to discuss for [phase name]?"`
       (same on every page)
     - `multiSelect: true`
     - `options: page.options` (≤4 items, may include the "Show more areas →"
       nav slot as the last entry on non-last pages)

  4. After each non-last page:
     - Accumulate real selections into the result set (de-duplicate by label).
     - If "Show more areas →" was selected → advance to the next page.
     - If it was **not** selected → stop early; the user has finished picking.

  5. After the last page, accumulate selections and finalize.

  6. If the cumulative result is empty after the user is done, ask once:
     "No areas selected — want to pick at least one, or skip discuss-phase?"
     (single-select: "Re-open picker" / "Skip discuss-phase").

**Examples by domain:**

For "Post Feed" (visual feature):
```
☐ Layout style — Cards vs list vs timeline? Information density?
☐ Loading behavior — Infinite scroll or pagination? Pull to refresh?
☐ Content ordering — Chronological, algorithmic, or user choice?
☐ Post metadata — What info per post? Timestamps, reactions, author?
☐ Empty feed — What shows when there are no posts yet?
```

For "Database backup CLI" (command-line tool):
```
☐ Output format — JSON, table, or plain text? Verbosity levels?
☐ Progress reporting — Silent, progress bar, or verbose logging?
☐ Error recovery — Fail fast, retry, or prompt for action?
```

For "Organize photo library" (organization task):
```
☐ Grouping criteria — By date, location, faces, or events?
☐ Duplicate handling — Keep best, keep all, or prompt each time?
```

Continue to discuss_areas with selected areas.
</step>

<step name="discuss_areas">
For each selected area, conduct a focused discussion loop.

**Philosophy: Ask what's needed, then check.**

Each gray area has a natural resolution point — some need 1 question, others need 6. Ask questions until the key decisions for the area are captured, then check with the user.

**Signals an area is resolved:**
- All concrete choices have been made (layout, behavior, content, etc.)
- User's answers are getting specific / confirmatory
- No remaining ambiguity that would change implementation

**Signals more questions are needed:**
- User's answer opens a new sub-decision ("cards — but what about...")
- A choice implies follow-up (picked "infinite scroll" → need loading/error states)
- User gives a vague answer that needs pinning down

**For each area:**

1. **Announce the area:**
   ```
   Let's talk about [Area].
   ```

2. **Ask questions using AskUserQuestion:**
   - header: "[Area]" (max 12 chars — abbreviate if needed)
   - question: Start with the most impactful decision for the area
   - options: 2-3 concrete choices (AskUserQuestion adds "Other" automatically)
   - Include "You decide" as an option when reasonable — captures Claude discretion
   - **Always include "Use Codebase Explorer" as the LAST option** with description
     "Analyze the codebase to decide this automatically"
   - Each answer informs the next question (or signals completion)
   - Continue asking until the area's key decisions are captured
   - Typical range: 2-6 questions per area (varies by complexity)

3. **When area feels resolved OR after 6 questions (whichever comes first), check:**
   - header: "[Area]" (max 12 chars)
   - question: "Anything else about [area], or move on?"
   - options: "More questions" / "Next area"

   If "More questions" → continue asking until resolved, then check again
   If "Next area" → proceed to next selected area
   If "Other" (free text) → interpret intent: continuation phrases ("chat more", "keep going", "yes", "more") map to "More questions"; advancement phrases ("done", "move on", "next", "skip") map to "Next area". If ambiguous, ask: "Continue with more questions about [area], or move to the next area?"

4. **After all areas complete:**
   - header: "Done"
   - question: "That covers [list areas]. Ready to create context?"
   - options: "Create context" / "Revisit an area"

**Question design:**
- Options should be concrete, not abstract ("Cards" not "Option A")
- Each answer should inform the next question
- If user picks "Other", receive their input, reflect it back, confirm

**Codebase Explorer handler:**
When user selects "Use Codebase Explorer":

1. **Check CCE availability:**
   ```bash
   echo "$CCE_API_KEY"
   ```
   If not set: inform user ("Codebase Explorer not configured — set CCE_API_KEY to enable."),
   re-ask the same question without the CCE option. Stop here.

2. **Formulate query** from the current context:
   - Phase goal (from ROADMAP.md)
   - Current area being discussed
   - The specific question that was asked
   - The concrete options that were offered (so CCE can evaluate them)

   Query template: "In the context of [phase goal], regarding [area]:
   [question text]. The options being considered are: [list options].
   Analyze the codebase to determine which approach is best and why."

3. **Discover project (first time only):**
   ```bash
   BASE_URL="${CCE_BASE_URL:-https://ceb.datahat.io}"
   curl -sk --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $CCE_API_KEY" "$BASE_URL/api/projects"
   ```
   Pick the project matching the current codebase. If ambiguous, ask user once.
   Cache the project/stream choice for the rest of the session.

4. **Call CCE API:**
   ```bash
   BASE_URL="${CCE_BASE_URL:-https://ceb.datahat.io}"
   curl -sk -N --connect-timeout 10 --max-time 300 -X POST "$BASE_URL/api/chat" \
     -H "Authorization: Bearer $CCE_API_KEY" \
     -H "Content-Type: application/json" \
     -d "{\"message\": \"<QUERY>\", \"history\": [], \"model\": \"claude-sonnet-4-6\", \"project\": \"<PROJECT>\", \"stream\": \"develop\", \"diagram_mode\": \"mermaid\", \"reasoning_mode\": \"low-level\", \"user_role\": \"developer\"}" \
     2>/dev/null | python3 -c "
   import sys, json
   r = []
   for line in sys.stdin:
       line = line.strip()
       if not line.startswith('data: '): continue
       try:
           evt = json.loads(line[6:])
           if evt.get('type') == 'content_delta':
               r.append(evt['data']['text'])
       except: pass
   print(''.join(r))
   "
   ```

5. **On success — auto-answer (no re-asking):**
   - Synthesize the CCE analysis into a concrete decision for the question
   - Present brief summary to user:
     ```
     **Codebase Explorer →** [1-2 sentence synthesized decision with key evidence]
     ```
   - Record the decision internally, attributed to CCE (for the "Codebase-Informed" section in CONTEXT.md)
   - Continue to the next question in the area (or area resolution check) — do NOT re-ask

6. **On failure** (timeout, HTTP error, empty response):
   - Inform user: "Codebase Explorer query failed: [reason]"
   - Re-ask the same question WITHOUT the "Use Codebase Explorer" option

**Scope creep handling:**
If user mentions something outside the phase domain:
```
"[Feature] sounds like a new capability — that belongs in its own phase.
I'll note it as a deferred idea.

Back to [current area]: [return to current question]"
```

Track deferred ideas internally.
</step>

<step name="write_context">
Create CONTEXT.md capturing decisions made.

**Find or create phase directory:**

Use values from init: `phase_dir`, `phase_slug`, `padded_phase`.

If `phase_dir` is null (phase exists in roadmap but no directory):
```bash
mkdir -p ".planning/phases/${padded_phase}-${phase_slug}"
```

**File location:** `${phase_dir}/${padded_phase}-CONTEXT.md`

**Structure the content by what was discussed:**

```markdown
# Phase [X]: [Name] - Context

**Gathered:** [date]
**Status:** Ready for planning

<domain>
## Phase Boundary

[Clear statement of what this phase delivers — the scope anchor]

</domain>

<upstream>
## Upstream Decisions

[Decisions already made in PROJECT.md, REQUIREMENTS.md, or phase research — carried forward, not re-asked]

- [Decision] (source: REQ-XXX / PROJECT.md / RESEARCH.md)

[If none: omit this section entirely]

</upstream>

<decisions>
## Implementation Decisions

### [Category 1 that was discussed]
- [Decision or preference captured]
- [Another decision if applicable]

### [Category 2 that was discussed]
- [Decision or preference captured]

### Codebase-Informed
[Decisions where user selected "Use Codebase Explorer" — Claude analyzed
the codebase and chose based on evidence. Each includes the rationale
so downstream agents can verify and build on the analysis.]
- [Decision] — [brief evidence from codebase] *(via Codebase Explorer)*

[If no CCE-informed decisions were made: omit this section]

### Claude's Discretion
[Areas where user said "you decide" — note that Claude has flexibility here]

</decisions>

<specifics>
## Specific Ideas

[Any particular references, examples, or "I want it like X" moments from discussion]

[If none: "No specific requirements — open to standard approaches"]

</specifics>

<deferred>
## Deferred Ideas

[Ideas that came up but belong in other phases. Don't lose them.]

[If none: "None — discussion stayed within phase scope"]

</deferred>

---

*Phase: XX-name*
*Context gathered: [date]*
```

Write file.
</step>

<step name="confirm_creation">
Present summary and next steps:

```
Created: .planning/phases/${PADDED_PHASE}-${SLUG}/${PADDED_PHASE}-CONTEXT.md

## Decisions Captured

### [Category]
- [Key decision]

### [Category]
- [Key decision]

[If deferred ideas exist:]
## Noted for Later
- [Deferred idea] — future phase

---

## ▶ Next Up

**Phase ${PHASE}: [Name]** — [Goal from ROADMAP.md]

`/forge-plan-phase ${PHASE}`

<sub>`/clear` first → fresh context window</sub>

---

**Also available:**
- `/forge-plan-phase ${PHASE} --skip-research` — plan without research
- Review/edit CONTEXT.md before continuing

---
```
</step>

<step name="git_commit">
Commit phase context (uses `commit_docs` from init internally):

```bash
node ~/.claude/forge-cli/bin/forge-tools.cjs commit "docs(${padded_phase}): capture phase context" --files "${phase_dir}/${padded_phase}-CONTEXT.md"
```

Confirm: "Committed: docs(${padded_phase}): capture phase context"

**Ledger:** Log decisions captured during discussion. For each decision in CONTEXT.md:
```bash
TOOLS="$HOME/.claude/forge-cli/bin/forge-tools.cjs"
# Log each major decision from the discussion
node "$TOOLS" ledger log-decision "${DECISION_TEXT}" --rationale "${RATIONALE_FROM_DISCUSSION}" 2>/dev/null
# Log any user preferences expressed
node "$TOOLS" ledger log-preference "${PREFERENCE_TEXT}" 2>/dev/null
```
</step>

<step name="update_state">
Update STATE.md with session info:

```bash
node ~/.claude/forge-cli/bin/forge-tools.cjs state record-session \
  --stopped-at "Phase ${PHASE} context gathered" \
  --resume-file "${phase_dir}/${padded_phase}-CONTEXT.md"
```

Commit STATE.md:

```bash
node ~/.claude/forge-cli/bin/forge-tools.cjs commit "docs(state): record phase ${PHASE} context session" --files .planning/STATE.md
```
</step>

<step name="auto_advance">
Check for auto-advance trigger:

1. Parse `--auto` flag from $ARGUMENTS
2. Read `workflow.auto_advance` from config:
   ```bash
   AUTO_CFG=$(node ~/.claude/forge-cli/bin/forge-tools.cjs config-get workflow.auto_advance 2>/dev/null || echo "false")
   ```

**If `--auto` flag present AND `AUTO_CFG` is not true:** Persist auto-advance to config (handles direct `--auto` usage without new-project):
```bash
node ~/.claude/forge-cli/bin/forge-tools.cjs config-set workflow.auto_advance true
```

**If `--auto` flag present OR `AUTO_CFG` is true:**

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Forge ► AUTO-ADVANCING TO PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Context captured. Spawning plan-phase...
```

Spawn plan-phase as Task:
```
Task(
  prompt="Run /forge-plan-phase ${PHASE} --auto",
  subagent_type="general-purpose",
  description="Plan Phase ${PHASE}"
)
```

**Handle plan-phase return:**
- **PLANNING COMPLETE** → Plan-phase handles chaining to execute-phase (via its own auto_advance step)
- **PLANNING INCONCLUSIVE / CHECKPOINT** → Display result, stop chain:
  ```
  Auto-advance stopped: Planning needs input.

  Review the output above and continue manually:
  /forge-plan-phase ${PHASE}
  ```

**If neither `--auto` nor config enabled:**
Route to `confirm_creation` step (existing behavior — show manual next steps).
</step>

</process>

<success_criteria>
- Phase validated against roadmap
- Gray areas identified through intelligent analysis (not generic questions)
- User selected which areas to discuss
- Each selected area explored until user satisfied
- Scope creep redirected to deferred ideas
- CONTEXT.md captures actual decisions, not vague vision
- Deferred ideas preserved for future phases
- STATE.md updated with session info
- User knows next steps
</success_criteria>
