'use strict';

/**
 * tests/e2e/project6.discuss-phase-picker.cjs
 *
 * Project 6: Paginated AskUserQuestion picker (lift-the-4-cap feature).
 *
 * What it exercises end-to-end
 * ----------------------------
 *  - `forge-cli/lib/picker.js`            (the pagination algorithm)
 *  - `forge-tools picker paginate` CLI    (JSON I/O, --options, --nav-label,
 *                                          --options @path, error paths)
 *  - The selection / advance protocol     (partitionSelections)
 *  - The "simulated workflow" — runs the picker the way
 *    `/forge-discuss-phase`, `/forge-new-milestone`, `/forge-new-project`,
 *    and `/forge-enhance-requirements` use it: emit one page, collect the
 *    user's picks + nav, advance, accumulate, finalize.
 *
 * The test runs each scenario through the CLI (so we cover the JSON contract
 * downstream workflows actually see) AND through the library directly, then
 * asserts that the two agree.
 */

const path = require('path');
const fs = require('fs');
const h = require('./harness.cjs');

const PICKER = require(path.join(h.FDP_ROOT, 'forge-cli', 'lib', 'picker.js'));

// ---------- helpers --------------------------------------------------------

function makeOptions(n, prefix) {
  prefix = prefix || 'Area';
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({ label: `${prefix} ${i}`, description: `Description ${i}` });
  }
  return out;
}

function cliPaginate(root, options, extraArgs) {
  const args = ['picker', 'paginate', '--options', JSON.stringify(options)];
  if (extraArgs) for (const a of extraArgs) args.push(a);
  const r = h.runForge(root, args);
  if (r.code !== 0) {
    throw new Error(`cli paginate failed (code=${r.code}): ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout);
}

function assertPageShape(pages, n, label) {
  // Every page has 2..4 options.
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    h.assert(
      p.options.length >= 2 && p.options.length <= 4,
      `${label}: page ${i} options=${p.options.length} violates 2..4`,
    );
  }
  // Only last page has no nav slot.
  for (let i = 0; i < pages.length; i++) {
    const last = pages[i].options[pages[i].options.length - 1];
    const hasNav = !!(last && last.__nav === true);
    if (i < pages.length - 1) {
      h.assert(hasNav, `${label}: non-last page ${i} must end with nav slot`);
      h.assert(pages[i].isLast === false, `${label}: non-last page ${i}: isLast must be false`);
    } else {
      h.assert(!hasNav, `${label}: last page ${i} must not have nav slot`);
      h.assert(pages[i].isLast === true, `${label}: last page ${i}: isLast must be true`);
    }
  }
  // Total user-pickable options == n.
  let count = 0;
  for (const p of pages) for (const o of p.options) if (o.__nav !== true) count++;
  h.assert(count === n, `${label}: expected ${n} user options across pages, got ${count}`);
}

// Simulate a user picking ALL user-options on every page and clicking the nav
// slot on every non-last page. Walks the full pagination, accumulating picks
// the way the workflow loop does.
function simulatePickAll(pages) {
  const accumulated = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    // Pretend the user picked every option on this page (real + nav if present).
    const selections = page.options.slice();
    const { picked, advance } = PICKER.partitionSelections(selections);
    for (const p of picked) accumulated.push(p);
    // On a non-last page, the nav MUST have been triggered.
    if (i < pages.length - 1) {
      h.assert(advance === true,
        `simulatePickAll: page ${i} (non-last) expected advance=true`);
    } else {
      h.assert(advance === false,
        `simulatePickAll: last page ${i} expected advance=false`);
    }
  }
  return accumulated;
}

// Simulate a user clicking only the nav on every non-last page, then picking
// just one option on the last page. (Tests that nav-only pages do not crash
// the accumulator, and that the last page still resolves.)
function simulateNavOnly(pages) {
  const accumulated = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    let selections;
    if (i < pages.length - 1) {
      // Just the nav slot.
      selections = [page.options[page.options.length - 1]];
    } else {
      // Last page: pick the first real option.
      selections = [page.options[0]];
    }
    const { picked, advance } = PICKER.partitionSelections(selections);
    for (const p of picked) accumulated.push(p);
    if (i < pages.length - 1) {
      h.assert(advance === true, `simulateNavOnly: page ${i} expected advance=true`);
      h.assert(picked.length === 0, `simulateNavOnly: page ${i} should have 0 real picks`);
    } else {
      h.assert(advance === false, `simulateNavOnly: last page expected advance=false`);
    }
  }
  return accumulated;
}

// Simulate stopping early: pick one option on the first page and DON'T click
// nav. Workflow should treat this as "user is done — proceed with what they
// picked so far". We verify partitionSelections reports advance=false.
function simulateStopEarly(pages) {
  if (pages.length === 0) return [];
  const page = pages[0];
  const real = page.options.filter(o => o.__nav !== true);
  h.assert(real.length >= 1, 'simulateStopEarly: need at least one real option');
  const selections = [real[0]];
  const { picked, advance } = PICKER.partitionSelections(selections);
  h.assert(advance === false, 'simulateStopEarly: no nav picked → advance must be false');
  h.assert(picked.length === 1, 'simulateStopEarly: should have exactly 1 pick');
  return picked;
}

// Verify CLI output matches library output for the same input.
function assertCliMatchesLib(cliRes, libRes, label) {
  h.assert(cliRes.total === libRes.total,
    `${label}: cli.total=${cliRes.total} vs lib.total=${libRes.total}`);
  h.assert(cliRes.pages.length === libRes.pages.length,
    `${label}: cli.pages=${cliRes.pages.length} vs lib.pages=${libRes.pages.length}`);
  for (let i = 0; i < cliRes.pages.length; i++) {
    const cp = cliRes.pages[i], lp = libRes.pages[i];
    h.assert(cp.options.length === lp.options.length,
      `${label}: page ${i} option counts differ`);
    h.assert(cp.isLast === lp.isLast,
      `${label}: page ${i} isLast differs`);
    for (let j = 0; j < cp.options.length; j++) {
      h.assert(cp.options[j].label === lp.options[j].label,
        `${label}: page ${i} option ${j} label differs`);
      h.assert(!!cp.options[j].__nav === !!lp.options[j].__nav,
        `${label}: page ${i} option ${j} __nav differs`);
    }
  }
}

// ---------- scenarios ------------------------------------------------------

function run() {
  const ledger = h.newLedger('project6-discuss-phase-picker');
  const root = h.createProject('discuss-phase-picker');
  try {
    h.gitInit(root);

    // ------------------------------------------------------------------
    // Scenario 1: N=2 — fast-path single page, no nav.
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(2);
      const lib = PICKER.paginate(opts);
      const cli = cliPaginate(root, opts);
      assertCliMatchesLib(cli, lib, 'N=2');
      h.assert(lib.pages.length === 1, 'N=2: one page');
      h.assert(lib.pages[0].isLast === true, 'N=2: single page is last');
      h.assert(lib.pages[0].options.length === 2, 'N=2: page has 2 options');
      for (const o of lib.pages[0].options) {
        h.assert(o.__nav !== true, 'N=2: no nav on fast path');
      }
      h.record(ledger, 'scenario:N=2 fast-path', 'pass',
        `pages=${lib.pages.length} options=[${lib.pages[0].options.map(o => o.label).join(', ')}]`);
    }

    // ------------------------------------------------------------------
    // Scenario 2: N=4 — fast-path boundary, single page, no nav.
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(4);
      const lib = PICKER.paginate(opts);
      const cli = cliPaginate(root, opts);
      assertCliMatchesLib(cli, lib, 'N=4');
      h.assert(lib.pages.length === 1, 'N=4: one page');
      h.assert(lib.pages[0].options.length === 4, 'N=4: page has 4 options');
      h.assert(lib.pages[0].isLast === true, 'N=4: single page is last');
      for (const o of lib.pages[0].options) {
        h.assert(o.__nav !== true, 'N=4: no nav at fast-path boundary');
      }
      h.record(ledger, 'scenario:N=4 fast-path boundary', 'pass',
        `pages=${lib.pages.length} optionsPerPage=${lib.pages[0].options.length}`);
    }

    // ------------------------------------------------------------------
    // Scenario 3: N=5 — first page over the cap, expect [3+nav][2].
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(5);
      const lib = PICKER.paginate(opts);
      const cli = cliPaginate(root, opts);
      assertCliMatchesLib(cli, lib, 'N=5');
      assertPageShape(lib.pages, 5, 'N=5');
      h.assert(lib.pages.length === 2, 'N=5: two pages');
      h.assert(lib.pages[0].options.length === 4, 'N=5: page 0 has 4 slots');
      h.assert(lib.pages[0].options[3].__nav === true, 'N=5: page 0 last is nav');
      h.assert(lib.pages[1].options.length === 2, 'N=5: page 1 has 2 options');
      // Simulate user picking all 5 across the two pages.
      const all = simulatePickAll(lib.pages);
      h.assert(all.length === 5, `N=5: picked ${all.length} expected 5`);
      h.assert(all.map(o => o.label).join('|') === opts.map(o => o.label).join('|'),
        'N=5: pick-all preserves order');
      h.record(ledger, 'scenario:N=5 paginated [3+nav][2]', 'pass',
        `picked-all=${all.length} order-ok`);
    }

    // ------------------------------------------------------------------
    // Scenario 4: N=7 — must avoid leaving a 1-option last page.
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(7);
      const lib = PICKER.paginate(opts);
      const cli = cliPaginate(root, opts);
      assertCliMatchesLib(cli, lib, 'N=7');
      assertPageShape(lib.pages, 7, 'N=7');
      h.assert(lib.pages.length === 3, 'N=7: three pages');
      h.assert(lib.pages[0].options.length === 4, 'N=7: page 0 has 4 slots');
      h.assert(lib.pages[1].options.length === 3, 'N=7: page 1 has 3 slots');
      h.assert(lib.pages[1].options[2].__nav === true, 'N=7: page 1 last is nav');
      h.assert(lib.pages[2].options.length === 2, 'N=7: page 2 has 2 options');
      h.assert(lib.pages[2].isLast === true, 'N=7: page 2 is last');
      // Simulate nav-only walk, then pick first option on last page.
      const navWalk = simulateNavOnly(lib.pages);
      h.assert(navWalk.length === 1, `N=7: nav-only walk picked ${navWalk.length} expected 1`);
      h.record(ledger, 'scenario:N=7 [3+nav][2+nav][2] avoids orphan', 'pass',
        `pages=${lib.pages.length} nav-walk-picked=${navWalk.length}`);
    }

    // ------------------------------------------------------------------
    // Scenario 5: N=10 — multi-page mixed selections.
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(10);
      const lib = PICKER.paginate(opts);
      const cli = cliPaginate(root, opts);
      assertCliMatchesLib(cli, lib, 'N=10');
      assertPageShape(lib.pages, 10, 'N=10');
      // pick-all should yield all 10 labels in input order.
      const all = simulatePickAll(lib.pages);
      h.assert(all.length === 10, `N=10: picked ${all.length} expected 10`);
      for (let i = 0; i < 10; i++) {
        h.assert(all[i].label === opts[i].label,
          `N=10: position ${i} label drift '${all[i].label}' != '${opts[i].label}'`);
      }
      // stop-early should yield exactly the first option, advance=false.
      const stop = simulateStopEarly(lib.pages);
      h.assert(stop.length === 1 && stop[0].label === opts[0].label,
        'N=10: stop-early picked the first option');
      h.record(ledger, 'scenario:N=10 multi-page mixed', 'pass',
        `pages=${lib.pages.length} pick-all=${all.length} stop-early=${stop.length}`);
    }

    // ------------------------------------------------------------------
    // Scenario 6: N=12 — four pages, last is exactly 3.
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(12);
      const lib = PICKER.paginate(opts);
      const cli = cliPaginate(root, opts);
      assertCliMatchesLib(cli, lib, 'N=12');
      assertPageShape(lib.pages, 12, 'N=12');
      h.assert(lib.pages.length === 4, 'N=12: four pages');
      h.assert(lib.pages[3].options.length === 3, 'N=12: last page has 3 options');
      h.assert(lib.pages[3].isLast === true, 'N=12: last page isLast=true');
      const all = simulatePickAll(lib.pages);
      h.assert(all.length === 12, `N=12: picked ${all.length} expected 12`);
      h.record(ledger, 'scenario:N=12 four pages [3+nav]x3 + [3]', 'pass',
        `pages=${lib.pages.length} last=${lib.pages[3].options.length}`);
    }

    // ------------------------------------------------------------------
    // Scenario 7: invariant sweep N=5..20.
    // ------------------------------------------------------------------
    {
      let sweepOk = true;
      let sweepDetail = '';
      for (let n = 5; n <= 20; n++) {
        const opts = makeOptions(n);
        const lib = PICKER.paginate(opts);
        try {
          assertPageShape(lib.pages, n, `sweep N=${n}`);
          // No duplicates and order preserved across pages.
          const flat = [];
          for (const p of lib.pages) for (const o of p.options) if (o.__nav !== true) flat.push(o);
          if (flat.length !== n) throw new Error(`flat length ${flat.length} != ${n}`);
          for (let i = 0; i < n; i++) {
            if (flat[i].label !== opts[i].label) {
              throw new Error(`order broken at index ${i}: '${flat[i].label}' != '${opts[i].label}'`);
            }
          }
          // Last page minItems=2.
          const last = lib.pages[lib.pages.length - 1];
          if (last.options.length < 2) {
            throw new Error(`N=${n}: last page has ${last.options.length} options, expected >=2`);
          }
        } catch (e) {
          sweepOk = false;
          sweepDetail = `N=${n}: ${e.message}`;
          break;
        }
      }
      h.record(ledger, 'scenario:invariant sweep N=5..20', sweepOk ? 'pass' : 'fail',
        sweepOk ? '16 N-values OK' : sweepDetail);
      if (!sweepOk) throw new Error(sweepDetail);
    }

    // ------------------------------------------------------------------
    // Scenario 8: custom nav label / description via CLI flags.
    // (Mirrors how /forge-discuss-phase invokes it for "Show more areas →".)
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(6, 'Area');
      const cli = cliPaginate(root, opts, [
        '--nav-label', 'Show more areas →',
        '--nav-description', 'Show more gray areas to choose from',
      ]);
      h.assert(cli.pages.length >= 2, 'custom nav: expected >=2 pages for N=6');
      const nav = cli.pages[0].options[cli.pages[0].options.length - 1];
      h.assert(nav.label === 'Show more areas →', 'custom nav: label mismatch');
      h.assert(nav.description === 'Show more gray areas to choose from',
        'custom nav: description mismatch');
      h.assert(nav.__nav === true, 'custom nav: __nav not preserved');
      // partitionSelections must still treat it as nav (via __nav flag).
      const { picked, advance } = PICKER.partitionSelections([nav, cli.pages[0].options[0]]);
      h.assert(advance === true, 'custom nav: partitionSelections.advance must be true');
      h.assert(picked.length === 1, 'custom nav: real pick should be 1');
      h.assert(picked[0].label === opts[0].label, 'custom nav: real pick label drift');
      h.record(ledger, 'scenario:custom nav label', 'pass',
        `label='${nav.label}' advance=true real=${picked.length}`);
    }

    // ------------------------------------------------------------------
    // Scenario 9: --options @path file input (workflows pre-stage gray
    // areas to a tmp file when JSON is long).
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(8, 'Feature');
      const tmp = path.join(root, '.forge', 'picker-options.json');
      fs.writeFileSync(tmp, JSON.stringify(opts));
      const r = h.runForge(root, ['picker', 'paginate', '--options', '@' + tmp]);
      h.assert(r.code === 0, `@path: cli failed code=${r.code} stderr=${r.stderr}`);
      const parsed = JSON.parse(r.stdout);
      h.assert(parsed.total === 8, `@path: total expected 8 got ${parsed.total}`);
      h.assert(parsed.pages.length === 3, `@path: expected 3 pages got ${parsed.pages.length}`);
      h.record(ledger, 'scenario:--options @path file input', 'pass',
        `total=${parsed.total} pages=${parsed.pages.length}`);
    }

    // ------------------------------------------------------------------
    // Scenario 10: error paths — missing --options, invalid JSON.
    // ------------------------------------------------------------------
    {
      const miss = h.runForge(root, ['picker', 'paginate']);
      h.assert(miss.code !== 0, 'missing --options: expected non-zero exit');
      h.assert(/Usage/.test(miss.stderr) || /Usage/.test(miss.stdout),
        'missing --options: expected Usage hint');
      h.record(ledger, 'scenario:error path missing --options', 'pass',
        `code=${miss.code}`);

      const bad = h.runForge(root, ['picker', 'paginate', '--options', 'not-json{']);
      h.assert(bad.code !== 0, 'invalid json: expected non-zero exit');
      h.assert(/not valid JSON/.test(bad.stderr),
        `invalid json: stderr should explain, got: ${bad.stderr}`);
      h.record(ledger, 'scenario:error path invalid JSON', 'pass',
        `code=${bad.code}`);
    }

    // ------------------------------------------------------------------
    // Scenario 11: real-workflow simulation — "Show more rewrites →" from
    // /forge-enhance-requirements. N=9, accept-all on last page is recorded.
    // ------------------------------------------------------------------
    {
      const opts = makeOptions(9, 'Rewrite');
      const lib = PICKER.paginate(opts, { navLabel: 'Show more rewrites →' });
      assertPageShape(lib.pages, 9, 'N=9 rewrites');
      h.assert(lib.pages.length === 3, 'N=9 rewrites: expected 3 pages');
      // Walk: pick first two options on page 0, just nav on page 1, both on page 2.
      const totalPicks = [];
      // Page 0: pick first two, then nav (we manually pick the nav slot).
      {
        const p = lib.pages[0];
        const sel = [p.options[0], p.options[1], p.options[p.options.length - 1]];
        const r = PICKER.partitionSelections(sel);
        h.assert(r.advance === true, 'rewrites: page 0 advance');
        h.assert(r.picked.length === 2, 'rewrites: page 0 picked 2');
        for (const o of r.picked) totalPicks.push(o);
      }
      // Page 1: pick nothing, just nav.
      {
        const p = lib.pages[1];
        const sel = [p.options[p.options.length - 1]];
        const r = PICKER.partitionSelections(sel);
        h.assert(r.advance === true, 'rewrites: page 1 advance');
        h.assert(r.picked.length === 0, 'rewrites: page 1 picked 0');
      }
      // Page 2 (last): pick all real options.
      {
        const p = lib.pages[2];
        const sel = p.options.filter(o => o.__nav !== true);
        const r = PICKER.partitionSelections(sel);
        h.assert(r.advance === false, 'rewrites: last page advance=false');
        h.assert(r.picked.length === p.options.length,
          `rewrites: last page picked all ${p.options.length}`);
        for (const o of r.picked) totalPicks.push(o);
      }
      h.assert(totalPicks.length >= 2,
        `rewrites: total picks should accumulate, got ${totalPicks.length}`);
      h.record(ledger, 'scenario:enhance-requirements rewrites N=9 walk', 'pass',
        `accumulated=${totalPicks.length} across ${lib.pages.length} pages`);
    }

    // ------------------------------------------------------------------
    // Scenario 12: real-workflow simulation — discuss-phase gray areas.
    // The actual command flow used by `/forge-discuss-phase`.
    // ------------------------------------------------------------------
    {
      const grayAreas = [
        { label: 'Layout style',       description: 'Single vs. multi-column' },
        { label: 'Loading behavior',   description: 'Skeleton vs. spinner vs. progressive' },
        { label: 'Empty state',        description: 'CTA vs. illustration vs. text' },
        { label: 'Error visibility',   description: 'Inline vs. toast vs. modal' },
        { label: 'Sorting defaults',   description: 'Recent vs. alphabetical' },
        { label: 'Pagination model',   description: 'Numbered vs. infinite scroll' },
        { label: 'Filter UX',          description: 'Pills vs. sidebar vs. modal' },
      ];
      // Workflow: paginate via CLI with custom nav-label "Show more areas →".
      const cli = cliPaginate(root, grayAreas, ['--nav-label', 'Show more areas →']);
      assertPageShape(cli.pages, grayAreas.length, 'discuss-phase gray areas');
      // User selects 3 areas to deep-dive — spread across pages.
      const desired = ['Loading behavior', 'Empty state', 'Pagination model'];
      const selected = [];
      for (let pi = 0; pi < cli.pages.length; pi++) {
        const page = cli.pages[pi];
        const sel = [];
        for (const o of page.options) {
          if (desired.includes(o.label)) sel.push(o);
        }
        // Advance unless we're on the last page.
        if (pi < cli.pages.length - 1) sel.push(page.options[page.options.length - 1]);
        const r = PICKER.partitionSelections(sel);
        for (const p of r.picked) selected.push(p);
        if (pi < cli.pages.length - 1) {
          h.assert(r.advance === true, `gray-areas: page ${pi} advance`);
        }
      }
      h.assert(selected.length === 3,
        `gray-areas: expected 3 selections, got ${selected.length} (${selected.map(s => s.label).join(', ')})`);
      const labels = selected.map(s => s.label).sort();
      const want = desired.slice().sort();
      h.assert(JSON.stringify(labels) === JSON.stringify(want),
        `gray-areas: selection mismatch want=${want.join(', ')} got=${labels.join(', ')}`);
      h.record(ledger, 'scenario:discuss-phase gray areas (real flow)', 'pass',
        `selected=${labels.join(', ')} pages=${cli.pages.length}`);
    }

    // ------------------------------------------------------------------
    // Scenario 13: paginated-picker.md reference doc shipped.
    // (Workflows @-include this; if missing, AskUserQuestion calls would
    // silently fall back to truncating options — the bug we're fixing.)
    // ------------------------------------------------------------------
    {
      const ref = path.join(h.FDP_ROOT, 'forge-cli', 'references', 'paginated-picker.md');
      h.assert(fs.existsSync(ref),
        `references/paginated-picker.md must exist (was not shipped)`);
      const body = fs.readFileSync(ref, 'utf8');
      h.assert(/paginate/i.test(body) && /nav/i.test(body),
        'references/paginated-picker.md content looks empty/incomplete');
      // Workflows that should reference it.
      const wfDir = path.join(h.FDP_ROOT, 'forge-cli', 'workflows');
      const expects = [
        'discuss-phase.md',
        'new-milestone.md',
        'new-project.md',
        'enhance-requirements.md',
      ];
      for (const wf of expects) {
        const p = path.join(wfDir, wf);
        h.assert(fs.existsSync(p), `workflow ${wf} missing`);
        const txt = fs.readFileSync(p, 'utf8');
        h.assert(/paginated-picker|picker paginate|Show more/i.test(txt),
          `workflow ${wf} does not reference the paginated picker pattern`);
      }
      h.record(ledger, 'scenario:reference doc + workflow wiring', 'pass',
        `paginated-picker.md exists; ${expects.length} workflows reference it`);
    }

  } catch (err) {
    h.record(ledger, 'fatal', 'fail', String(err && err.message || err));
  } finally {
    h.finalize(ledger);
    h.writeReport(ledger);
    h.destroyProject(root);
  }
  return ledger;
}

if (require.main === module) {
  const l = run();
  process.exitCode = l.fail === 0 ? 0 : 1;
}

module.exports = { run };
