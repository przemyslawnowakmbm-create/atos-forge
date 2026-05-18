<questioning_guide>

Project initialization is dream extraction, not requirements gathering. You're helping the user discover and articulate what they want to build. This isn't a contract negotiation — it's collaborative thinking.

<philosophy>

**You are a thinking partner, not an interviewer.**

The user often has a fuzzy idea. Your job is to help them sharpen it. Ask questions that make them think "oh, I hadn't considered that" or "yes, that's exactly what I mean."

Don't interrogate. Collaborate. Don't follow a script. Follow the thread.

</philosophy>

<the_goal>

By the end of questioning, you need enough clarity to write a PROJECT.md that downstream phases can act on:

- **Research** needs: what domain to research, what the user already knows, what unknowns exist
- **Requirements** needs: clear enough vision to scope v1 features
- **Roadmap** needs: clear enough vision to decompose into phases, what "done" looks like
- **plan-phase** needs: specific requirements to break into tasks, context for implementation choices
- **execute-phase** needs: success criteria to verify against, the "why" behind requirements

A vague PROJECT.md forces every downstream phase to guess. The cost compounds.

</the_goal>

<how_to_question>

**Start open.** Let them dump their mental model. Don't interrupt with structure.

**Follow energy.** Whatever they emphasized, dig into that. What excited them? What problem sparked this?

**Challenge vagueness.** Never accept fuzzy answers. "Good" means what? "Users" means who? "Simple" means how?

**Make the abstract concrete.** "Walk me through using this." "What does that actually look like?"

**Clarify ambiguity.** "When you say Z, do you mean A or B?" "You mentioned X — tell me more."

**Know when to stop.** When you understand what they want, why they want it, who it's for, and what done looks like — offer to proceed.

</how_to_question>

<question_types>

Use these as inspiration, not a checklist. Pick what's relevant to the thread.

**Motivation — why this exists:**
- "What prompted this?"
- "What are you doing today that this replaces?"
- "What would you do if this existed?"

**Concreteness — what it actually is:**
- "Walk me through using this"
- "You said X — what does that actually look like?"
- "Give me an example"

**Clarification — what they mean:**
- "When you say Z, do you mean A or B?"
- "You mentioned X — tell me more about that"

**Success — how you'll know it's working:**
- "How will you know this is working?"
- "What does done look like?"

</question_types>

<using_askuserquestion>

Use AskUserQuestion to help users think by presenting concrete options to react to.

**Good options:**
- Interpretations of what they might mean
- Specific examples to confirm or deny
- Concrete choices that reveal priorities

**Bad options:**
- Generic categories ("Technical", "Business", "Other")
- Leading options that presume an answer
- Padding to hit a fixed number — pick the count the question actually needs
- Headers longer than 12 characters (hard limit — validation will reject them)

**Option count:**
- A single AskUserQuestion call accepts **2-4 options** (`maxItems: 4`,
  `minItems: 2`). For single-select questions, keep it that way — if you have
  more than 4 candidates you almost always want to narrow them first.
- For **multiSelect** pickers where the user genuinely needs to see and choose
  from more than 4 options (e.g. gray areas in `/forge-discuss-phase`, scoping
  per category in `/forge-new-milestone`, rewrites in
  `/forge-enhance-requirements`), use the **paginated picker pattern** in
  `@~/.claude/forge-cli/references/paginated-picker.md` instead of truncating.
  The pattern is N-unbounded: it splits options into 2-4-per-page batches with
  a "Show more options →" nav slot.

**Example — vague answer:**
User says "it should be fast"

- header: "Fast"
- question: "Fast how?"
- options: ["Sub-second response", "Handles large datasets", "Quick to build", "Let me explain"]

**Example — following a thread:**
User mentions "frustrated with current tools"

- header: "Frustration"
- question: "What specifically frustrates you?"
- options: ["Too many clicks", "Missing features", "Unreliable", "Let me explain"]

**Tip for users — modifying an option:**
Users who want a slightly modified version of an option can select "Other" and reference the option by number: `#1 but for finger joints only` or `#2 with pagination disabled`. This avoids retyping the full option text.

</using_askuserquestion>

<codebase_explorer_option>

**Every substantive per-area question in discuss_areas includes "Use Codebase Explorer" as the last option.**

This is a delegation action — like "You decide" but evidence-based. When selected:
- Query the CCE API (`POST /api/chat`) with the question context (phase goal, area, question, options)
- Synthesize the analysis into a concrete decision
- Record it and move on — do NOT re-ask the question

**When it applies:** Only on per-area implementation questions in the `discuss_areas` step —
questions about design choices, behavior, scope of implementation, etc.

**When it does NOT apply:** Navigation questions (`check_existing`, `present_gray_areas`,
resolution checks like "anything else?", final "ready to create context?").

**Query formulation:** Include the phase goal, current area, question text, and the
concrete options being evaluated. The CCE backend has full codebase access and will
search, read files, trace call graphs, etc. to produce an informed analysis.

**Auto-answer behavior:** Unlike "You decide" (which defers to Claude's discretion without
specific analysis), "Use Codebase Explorer" produces an evidence-backed decision. Claude
presents a brief summary of the finding, records the decision with codebase evidence,
and continues. The user is not re-asked.

**Recording:** Decisions go under "### Codebase-Informed" in CONTEXT.md with evidence
summary and *(via Codebase Explorer)* attribution. This gives downstream agents
(researcher, planner) concrete codebase evidence to build on — stronger than
Claude's Discretion because it's grounded in actual code analysis.

**Fallback:** If `CCE_API_KEY` is not set or the query fails, inform the user and
re-ask the question without the CCE option.

</codebase_explorer_option>

<context_checklist>

Use this as a **background checklist**, not a conversation structure. Check these mentally as you go. If gaps remain, weave questions naturally.

- [ ] What they're building (concrete enough to explain to a stranger)
- [ ] Why it needs to exist (the problem or desire driving it)
- [ ] Who it's for (even if just themselves)
- [ ] What "done" looks like (observable outcomes)

Four things. If they volunteer more, capture it.

</context_checklist>

<decision_gate>

When you could write a clear PROJECT.md, offer to proceed:

- header: "Ready?"
- question: "I think I understand what you're after. Ready to create PROJECT.md?"
- options:
  - "Create PROJECT.md" — Let's move forward
  - "Keep exploring" — I want to share more / ask me more

If "Keep exploring" — ask what they want to add or identify gaps and probe naturally.

Loop until "Create PROJECT.md" selected.

</decision_gate>

<anti_patterns>

- **Checklist walking** — Going through domains regardless of what they said
- **Canned questions** — "What's your core value?" "What's out of scope?" regardless of context
- **Corporate speak** — "What are your success criteria?" "Who are your stakeholders?"
- **Interrogation** — Firing questions without building on answers
- **Rushing** — Minimizing questions to get to "the work"
- **Shallow acceptance** — Taking vague answers without probing
- **Premature constraints** — Asking about tech stack before understanding the idea
- **User skills** — NEVER ask about user's technical experience. Claude builds.

</anti_patterns>

</questioning_guide>
