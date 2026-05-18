<paginated_picker>

# Paginated Picker Pattern

`AskUserQuestion` accepts **2..4 options per call** (`maxItems: 4`, `minItems: 2`).
When a workflow needs to offer more than 4 choices in a single multiSelect picker,
use this paginated pattern — it preserves the clickable picker UX while letting
N grow unbounded.

## When to apply

Any time a workflow would generate `> 4` options for a single multiSelect picker.
This currently applies to:

- `discuss-phase.md` — gray-area picker (`present_gray_areas`)
- `new-milestone.md` — per-category feature scope picker (`Scope each category`)
- `new-project.md` — per-category feature scope picker
- `enhance-requirements.md` — rewrites picker and gap-acceptance pickers

If `N <= 4`, **do not paginate** — make a single AskUserQuestion call as before.

## Algorithm

1. Compute the page split with the deterministic helper:
   ```bash
   node ~/.claude/forge-cli/bin/forge-tools.cjs picker paginate \
     --options '[{"label":"...","description":"..."}, ...]' \
     --nav-label "Show more options →" \
     --nav-description "Show more options to choose from"
   ```
   Output JSON:
   ```json
   {
     "pages": [
       { "options": [...3 user options + 1 nav...], "isLast": false },
       { "options": [...2..3 remaining options...],   "isLast": true  }
     ],
     "total": 7,
     "pageSize": 3
   }
   ```

2. Before the first page, print a **numbered overview** of every option so the
   user sees the full landscape before clicking:
   ```
   I see N gray areas worth discussing for this phase:
     1. Layout style
     2. Loading behavior
     3. Content ordering
     ...
     N. Notifications copy

   I'll show them in pages of 3. Pick the ones you want, then "Show more options →"
   to advance.
   ```
   Skip the overview if `pages.length === 1` (the legacy single-page path).

3. For each page, call AskUserQuestion with `multiSelect: true` and that page's
   `options` array (header `<= 12 chars`). The `nav` slot is the last entry for
   non-last pages.

4. After each non-last page's response:
   - Append any non-nav selections to the cumulative result set (de-duplicate by
     label).
   - If the nav option was selected → advance to the next page.
   - If the nav option was **not** selected → stop early; the user has finished
     picking, even if pages remain. Do not silently continue past their choice.

5. After the last page's response, append non-nav selections and finalize.

6. If the cumulative result set ends up empty, fall back to the workflow's usual
   "nothing selected" handling (e.g. re-ask, or skip the step). Do not invent
   selections.

## Selection mapping

Use `partitionSelections(selections)` from `forge-cli/lib/picker.js` (or the
inline rule below) to separate the nav sentinel from real picks:

- An option with `__nav: true` is the nav sentinel → advance.
- Any option whose label matches `/^show more options\s*→?$/i` is treated as
  the nav sentinel too (defensive, in case the tool strips internal fields).
- Everything else is a real selection.

## Header rules

`AskUserQuestion` headers are hard-capped at **12 characters**. When paginating,
keep the same header on every page so the user understands they're inside one
logical question (e.g. `"Discuss"`, `"Critical"`, `"Rewrites"`). Don't append
page numbers to the header — they eat the 12-char budget.

## Example shapes

| N  | Pages                                              |
|----|----------------------------------------------------|
| 2  | `[2]`                                              |
| 3  | `[3]`                                              |
| 4  | `[4]`                                              |
| 5  | `[3+nav][2]`                                       |
| 6  | `[3+nav][3]`                                       |
| 7  | `[3+nav][2+nav][2]`                                |
| 8  | `[3+nav][3+nav][2]`                                |
| 10 | `[3+nav][3+nav][2+nav][2]`                         |
| 12 | `[3+nav][3+nav][3+nav][3]`                         |

The split guarantees every page satisfies `2 <= options.length <= 4`, so no
AskUserQuestion call is ever rejected for size.

</paginated_picker>
