#!/usr/bin/env node
'use strict';

/**
 * tests/e2e/validate-installed.cjs
 *
 * Validates the installed atos-forge installation at ~/.claude/atos-forge/
 * against the same picker-pagination contract the repo enforces.
 *
 * Why a separate script:
 *   - The repo's harness binds FORGE_TOOLS to forge-cli/bin/forge-tools.cjs.
 *     We need to exercise the INSTALLED binary so we know the user's
 *     ~/.claude/atos-forge/ copy is fixed too.
 *
 * What it checks:
 *   1. Picker CLI works end-to-end (paginate, --nav-label, @path, error paths).
 *   2. Library output matches CLI output for N = 2, 4, 5, 7, 10, 12.
 *   3. Page shape invariants (2..4 per page, nav on non-last only, all options
 *      preserved, last page >= 2 options).
 *   4. partitionSelections correctly splits nav from real picks for both
 *      default and custom nav labels.
 *   5. Workflow files reference the paginated picker (no silent regression).
 *   6. paginated-picker.md exists with the right shape.
 *   7. questioning.md drops the old "2-4 is ideal" guidance.
 *
 * Exit code: 0 on success, 1 on any failure.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const INSTALLED_ROOT = path.join(os.homedir(), '.claude', 'atos-forge');
const INSTALLED_BIN  = path.join(INSTALLED_ROOT, 'bin', 'forge-tools.cjs');
const INSTALLED_LIB  = path.join(INSTALLED_ROOT, 'lib', 'picker.js');
const INSTALLED_REF  = path.join(INSTALLED_ROOT, 'references', 'paginated-picker.md');
const INSTALLED_Q    = path.join(INSTALLED_ROOT, 'references', 'questioning.md');
const INSTALLED_WF   = path.join(INSTALLED_ROOT, 'workflows');

const failures = [];
const passes = [];

function ok(name, detail) { passes.push({ name, detail: detail || '' }); }
function fail(name, msg)  { failures.push({ name, msg }); }

function runCli(args) {
  const r = spawnSync(process.execPath, [INSTALLED_BIN].concat(args), {
    encoding: 'utf8', timeout: 15000,
  });
  return { code: r.status == null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function makeOptions(n, prefix) {
  prefix = prefix || 'Area';
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ label: `${prefix} ${i}`, description: `Description ${i}` });
  return out;
}

function assertPages(pages, n, label) {
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.options.length < 2 || p.options.length > 4) {
      throw new Error(`${label}: page ${i} options=${p.options.length} violates 2..4`);
    }
    const last = p.options[p.options.length - 1];
    const hasNav = !!(last && last.__nav === true);
    if (i < pages.length - 1) {
      if (!hasNav) throw new Error(`${label}: non-last page ${i} must end with nav`);
      if (p.isLast !== false) throw new Error(`${label}: non-last page ${i} isLast must be false`);
    } else {
      if (hasNav) throw new Error(`${label}: last page must not have nav`);
      if (p.isLast !== true) throw new Error(`${label}: last page isLast must be true`);
    }
  }
  let count = 0;
  for (const p of pages) for (const o of p.options) if (o.__nav !== true) count++;
  if (count !== n) throw new Error(`${label}: expected ${n} options total, got ${count}`);
}

// ---------------------------------------------------------------------------
// 1. Files-on-disk preflight.
// ---------------------------------------------------------------------------

function check1_files() {
  for (const [label, p] of [
    ['installed binary',           INSTALLED_BIN],
    ['installed picker.js',        INSTALLED_LIB],
    ['paginated-picker.md',        INSTALLED_REF],
    ['questioning.md',             INSTALLED_Q],
  ]) {
    if (!fs.existsSync(p)) { fail(`file:${label}`, `missing: ${p}`); return; }
  }
  ok('file:preflight', 'all 4 install files present');

  // paginated-picker.md content sanity.
  const ref = fs.readFileSync(INSTALLED_REF, 'utf8');
  if (!/paginate/i.test(ref) || !/nav/i.test(ref)) {
    fail('file:paginated-picker.md content', 'missing paginate/nav language');
  } else {
    ok('file:paginated-picker.md content', 'has paginate + nav language');
  }

  // Workflow wiring.
  const wfs = ['discuss-phase.md', 'new-milestone.md', 'new-project.md', 'enhance-requirements.md'];
  for (const wf of wfs) {
    const p = path.join(INSTALLED_WF, wf);
    if (!fs.existsSync(p)) { fail(`workflow:${wf}`, 'missing'); continue; }
    const body = fs.readFileSync(p, 'utf8');
    const hasRef = /paginated-picker|picker paginate|Show more/i.test(body);
    if (!hasRef) fail(`workflow:${wf}`, 'no reference to paginated picker');
    else ok(`workflow:${wf}`, 'references paginated picker');
  }

  // questioning.md should no longer say "2-4 is ideal" and should reference
  // the paginated-picker doc.
  const q = fs.readFileSync(INSTALLED_Q, 'utf8');
  if (/2-4 is ideal/.test(q)) {
    fail('questioning.md', 'still contains stale "2-4 is ideal" guidance');
  } else {
    ok('questioning.md (no stale guidance)', 'OK');
  }
  if (!/paginated-picker/i.test(q)) {
    fail('questioning.md (paginated-picker ref)', 'no mention of paginated-picker.md');
  } else {
    ok('questioning.md (paginated-picker ref)', 'OK');
  }
}

// ---------------------------------------------------------------------------
// 2. CLI subcommand smoke tests.
// ---------------------------------------------------------------------------

function check2_cli() {
  // 2a. paginate with N=2 (fast path).
  const fast = runCli(['picker', 'paginate', '--options', JSON.stringify(makeOptions(2))]);
  if (fast.code !== 0) { fail('cli:N=2 fast path', fast.stderr || `code=${fast.code}`); return; }
  const fastP = JSON.parse(fast.stdout);
  try {
    assertPages(fastP.pages, 2, 'cli:N=2');
    ok('cli:N=2 fast path', `pages=${fastP.pages.length}`);
  } catch (e) { fail('cli:N=2 fast path', e.message); }

  // 2b. paginate with N=5 (paginated).
  const five = runCli(['picker', 'paginate', '--options', JSON.stringify(makeOptions(5))]);
  if (five.code !== 0) { fail('cli:N=5 paginated', five.stderr || `code=${five.code}`); return; }
  const fiveP = JSON.parse(five.stdout);
  try {
    assertPages(fiveP.pages, 5, 'cli:N=5');
    if (fiveP.pages.length !== 2) throw new Error(`expected 2 pages, got ${fiveP.pages.length}`);
    if (fiveP.pages[0].options.length !== 4) throw new Error(`page 0 should have 4 slots`);
    if (fiveP.pages[0].options[3].__nav !== true) throw new Error('page 0 last must be nav');
    ok('cli:N=5 paginated', '[3+nav][2] verified');
  } catch (e) { fail('cli:N=5 paginated', e.message); }

  // 2c. paginate with N=7 (avoid orphan).
  const seven = runCli(['picker', 'paginate', '--options', JSON.stringify(makeOptions(7))]);
  const sevenP = JSON.parse(seven.stdout);
  try {
    assertPages(sevenP.pages, 7, 'cli:N=7');
    if (sevenP.pages.length !== 3) throw new Error(`expected 3 pages, got ${sevenP.pages.length}`);
    if (sevenP.pages[2].options.length !== 2) throw new Error(`last page must be 2 options`);
    ok('cli:N=7 paginated', 'avoids orphan last page');
  } catch (e) { fail('cli:N=7 paginated', e.message); }

  // 2d. --nav-label custom.
  const cust = runCli([
    'picker', 'paginate',
    '--options', JSON.stringify(makeOptions(6)),
    '--nav-label', 'Show more areas →',
    '--nav-description', 'Custom desc',
  ]);
  const custP = JSON.parse(cust.stdout);
  try {
    const nav = custP.pages[0].options[custP.pages[0].options.length - 1];
    if (nav.label !== 'Show more areas →') throw new Error(`nav label '${nav.label}'`);
    if (nav.description !== 'Custom desc') throw new Error(`nav description '${nav.description}'`);
    if (nav.__nav !== true) throw new Error('__nav must be true');
    ok('cli:custom --nav-label', `'${nav.label}'`);
  } catch (e) { fail('cli:custom --nav-label', e.message); }

  // 2e. --options @path file mode.
  const tmp = path.join(os.tmpdir(), `picker-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(makeOptions(8, 'Feature')));
  const filed = runCli(['picker', 'paginate', '--options', '@' + tmp]);
  try {
    if (filed.code !== 0) throw new Error(`code=${filed.code} stderr=${filed.stderr}`);
    const p = JSON.parse(filed.stdout);
    if (p.total !== 8) throw new Error(`total=${p.total}`);
    assertPages(p.pages, 8, 'cli:@path');
    ok('cli:--options @path', `pages=${p.pages.length}`);
  } catch (e) { fail('cli:--options @path', e.message); }
  finally { try { fs.unlinkSync(tmp); } catch {} }

  // 2f. error path: missing --options.
  const miss = runCli(['picker', 'paginate']);
  if (miss.code === 0) fail('cli:missing --options', 'should have failed');
  else if (!/Usage/.test(miss.stderr + miss.stdout)) fail('cli:missing --options', 'no Usage hint');
  else ok('cli:missing --options', `code=${miss.code}`);

  // 2g. error path: invalid JSON.
  const bad = runCli(['picker', 'paginate', '--options', 'not-json{']);
  if (bad.code === 0) fail('cli:invalid JSON', 'should have failed');
  else if (!/not valid JSON/.test(bad.stderr)) fail('cli:invalid JSON', `stderr: ${bad.stderr}`);
  else ok('cli:invalid JSON', `code=${bad.code}`);
}

// ---------------------------------------------------------------------------
// 3. Library/CLI parity sweep.
// ---------------------------------------------------------------------------

function check3_parity() {
  const lib = require(INSTALLED_LIB);
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 17, 20]) {
    const opts = makeOptions(n);
    let libRes, cliRes;
    try { libRes = lib.paginate(opts); }
    catch (e) { fail(`parity:lib N=${n}`, e.message); continue; }
    const r = runCli(['picker', 'paginate', '--options', JSON.stringify(opts)]);
    if (r.code !== 0) { fail(`parity:cli N=${n}`, r.stderr); continue; }
    try { cliRes = JSON.parse(r.stdout); }
    catch (e) { fail(`parity:cli json N=${n}`, e.message); continue; }
    try {
      assertPages(libRes.pages, n, `parity:lib N=${n}`);
      assertPages(cliRes.pages, n, `parity:cli N=${n}`);
      if (libRes.pages.length !== cliRes.pages.length) {
        throw new Error(`page count differs lib=${libRes.pages.length} cli=${cliRes.pages.length}`);
      }
      for (let i = 0; i < libRes.pages.length; i++) {
        const lp = libRes.pages[i], cp = cliRes.pages[i];
        if (lp.options.length !== cp.options.length) {
          throw new Error(`page ${i} option count differs lib=${lp.options.length} cli=${cp.options.length}`);
        }
        for (let j = 0; j < lp.options.length; j++) {
          if (lp.options[j].label !== cp.options[j].label) {
            throw new Error(`page ${i} option ${j} label drift`);
          }
        }
      }
      ok(`parity:N=${n}`, `pages=${libRes.pages.length}`);
    } catch (e) { fail(`parity:N=${n}`, e.message); }
  }
}

// ---------------------------------------------------------------------------
// 4. partitionSelections behavior.
// ---------------------------------------------------------------------------

function check4_partition() {
  const lib = require(INSTALLED_LIB);
  // 4a. Nav via __nav flag.
  const r1 = lib.partitionSelections([
    { label: 'Show more areas →', __nav: true },
    { label: 'X' }, { label: 'Y' },
  ]);
  if (r1.advance !== true || r1.picked.length !== 2)
    fail('partition:nav __nav', `advance=${r1.advance} picked=${r1.picked.length}`);
  else ok('partition:nav __nav', 'OK');

  // 4b. Nav via default label (no __nav).
  const r2 = lib.partitionSelections([
    { label: 'Show more options →' }, { label: 'X' },
  ]);
  if (r2.advance !== true || r2.picked.length !== 1)
    fail('partition:nav by label', `advance=${r2.advance} picked=${r2.picked.length}`);
  else ok('partition:nav by label', 'OK');

  // 4c. No nav.
  const r3 = lib.partitionSelections([{ label: 'A' }, { label: 'B' }]);
  if (r3.advance !== false || r3.picked.length !== 2)
    fail('partition:no nav', `advance=${r3.advance} picked=${r3.picked.length}`);
  else ok('partition:no nav', 'OK');

  // 4d. Null input.
  const r4 = lib.partitionSelections(null);
  if (r4.advance !== false || r4.picked.length !== 0)
    fail('partition:null input', 'should be {picked:[], advance:false}');
  else ok('partition:null input', 'OK');
}

// ---------------------------------------------------------------------------
// 5. Real-workflow walkthroughs — emulate /forge-discuss-phase + rewrites.
// ---------------------------------------------------------------------------

function check5_walkthroughs() {
  const lib = require(INSTALLED_LIB);

  // 5a. Discuss-phase gray-area walk with 7 areas, selecting 3 specific items.
  const gray = [
    { label: 'Layout style' }, { label: 'Loading behavior' },
    { label: 'Empty state' },  { label: 'Error visibility' },
    { label: 'Sorting defaults' }, { label: 'Pagination model' },
    { label: 'Filter UX' },
  ];
  const pageRes = lib.paginate(gray, { navLabel: 'Show more areas →' });
  try { assertPages(pageRes.pages, 7, 'walkthrough:discuss-phase'); }
  catch (e) { fail('walkthrough:discuss-phase shape', e.message); return; }
  const want = ['Loading behavior', 'Empty state', 'Pagination model'];
  const picked = [];
  for (let pi = 0; pi < pageRes.pages.length; pi++) {
    const page = pageRes.pages[pi];
    const sel = [];
    for (const o of page.options) if (want.includes(o.label)) sel.push(o);
    if (pi < pageRes.pages.length - 1) sel.push(page.options[page.options.length - 1]);
    const r = lib.partitionSelections(sel);
    for (const p of r.picked) picked.push(p);
  }
  const labels = picked.map(p => p.label).sort();
  const wantS  = want.slice().sort();
  if (JSON.stringify(labels) !== JSON.stringify(wantS))
    fail('walkthrough:discuss-phase pick', `got=${labels.join(',')} want=${wantS.join(',')}`);
  else ok('walkthrough:discuss-phase pick', `selected=${labels.join(', ')}`);

  // 5b. Enhance-requirements rewrites — 9 rewrites, nav-only on middle page.
  const rewrites = makeOptions(9, 'Rewrite');
  const rPages = lib.paginate(rewrites, { navLabel: 'Show more rewrites →' });
  try { assertPages(rPages.pages, 9, 'walkthrough:rewrites'); }
  catch (e) { fail('walkthrough:rewrites shape', e.message); return; }
  const accum = [];
  for (let pi = 0; pi < rPages.pages.length; pi++) {
    const page = rPages.pages[pi];
    const sel = [];
    if (pi === 0) {
      // Pick first two + nav.
      sel.push(page.options[0], page.options[1]);
      sel.push(page.options[page.options.length - 1]);
    } else if (pi === 1) {
      // Just nav.
      sel.push(page.options[page.options.length - 1]);
    } else {
      // Last page: pick all.
      for (const o of page.options) if (o.__nav !== true) sel.push(o);
    }
    const r = lib.partitionSelections(sel);
    for (const p of r.picked) accum.push(p);
  }
  if (accum.length < 2) fail('walkthrough:rewrites accumulate', `accum=${accum.length}`);
  else ok('walkthrough:rewrites accumulate', `accumulated=${accum.length}`);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  check1_files();
  check2_cli();
  check3_parity();
  check4_partition();
  check5_walkthroughs();

  const bar = '═'.repeat(72);
  process.stdout.write(`\n${bar}\n  INSTALLED VALIDATION SUMMARY\n${bar}\n`);
  process.stdout.write(`  passes: ${passes.length}\n`);
  process.stdout.write(`  fails:  ${failures.length}\n`);
  if (failures.length) {
    process.stdout.write(`\n  Failures:\n`);
    for (const f of failures) process.stdout.write(`    - ${f.name}: ${f.msg}\n`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
