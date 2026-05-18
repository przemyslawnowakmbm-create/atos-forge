'use strict';

/**
 * tests/picker.test.cjs
 *
 * Unit tests for forge-cli/lib/picker.js — the paginated AskUserQuestion
 * picker helper that lets workflows offer more than the platform's 4-option
 * cap by splitting options into AskUserQuestion-shaped pages.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const PICKER = require(path.join(__dirname, '..', 'forge-cli', 'lib', 'picker.js'));
const FORGE_TOOLS = path.join(__dirname, '..', 'forge-cli', 'bin', 'forge-tools.cjs');

function makeOptions(n, prefix) {
  prefix = prefix || 'Area';
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({ label: `${prefix} ${i}`, description: `Description for ${prefix} ${i}` });
  }
  return out;
}

function flatten(pages) {
  const out = [];
  for (const page of pages) {
    for (const opt of page.options) {
      if (opt.__nav === true) continue;
      out.push(opt);
    }
  }
  return out;
}

function assertEveryPageWithinCap(pages) {
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    assert.ok(p.options.length >= 2, `page ${i}: expected >=2 options, got ${p.options.length}`);
    assert.ok(p.options.length <= 4, `page ${i}: expected <=4 options, got ${p.options.length}`);
  }
}

function assertOnlyLastPageNoNav(pages) {
  for (let i = 0; i < pages.length; i++) {
    const last = pages[i].options[pages[i].options.length - 1];
    const hasNav = !!(last && last.__nav === true);
    if (i < pages.length - 1) {
      assert.ok(hasNav, `non-last page ${i} must end with nav slot`);
      assert.strictEqual(pages[i].isLast, false, `non-last page ${i}: isLast must be false`);
    } else {
      assert.strictEqual(hasNav, false, `last page ${i} must not have nav slot`);
      assert.strictEqual(pages[pages.length - 1].isLast, true, 'last page: isLast must be true');
    }
  }
}

describe('picker.paginate — input validation', () => {
  it('throws on non-array input', () => {
    assert.throws(() => PICKER.paginate('not-an-array'), TypeError);
    assert.throws(() => PICKER.paginate(null), TypeError);
    assert.throws(() => PICKER.paginate(undefined), TypeError);
  });

  it('throws on options without label', () => {
    assert.throws(() => PICKER.paginate([{ description: 'no label' }]), TypeError);
    assert.throws(() => PICKER.paginate([{ label: 'ok' }, { foo: 'bar' }]), TypeError);
  });
});

describe('picker.paginate — fast path (N<=4)', () => {
  for (const n of [0, 1, 2, 3, 4]) {
    it(`N=${n}: single page, no nav slot, isLast=true`, () => {
      const r = PICKER.paginate(makeOptions(n));
      assert.strictEqual(r.total, n);
      assert.strictEqual(r.pages.length, 1, 'expected exactly one page');
      assert.strictEqual(r.pages[0].isLast, true);
      assert.strictEqual(r.pages[0].options.length, n);
      for (const o of r.pages[0].options) {
        assert.notStrictEqual(o.__nav, true, 'fast path must not include a nav slot');
      }
    });
  }
});

describe('picker.paginate — paginated path (N>4)', () => {
  for (let n = 5; n <= 20; n++) {
    it(`N=${n}: every page within cap, nav only on non-last pages, all options preserved`, () => {
      const opts = makeOptions(n);
      const r = PICKER.paginate(opts);
      assert.strictEqual(r.total, n);
      assert.ok(r.pages.length >= 2, `expected multiple pages for N=${n}, got ${r.pages.length}`);

      assertEveryPageWithinCap(r.pages);
      assertOnlyLastPageNoNav(r.pages);

      // All user-pickable options preserved, in order, no duplicates.
      const flat = flatten(r.pages);
      assert.strictEqual(flat.length, n, `expected ${n} options across pages, got ${flat.length}`);
      for (let i = 0; i < n; i++) {
        assert.strictEqual(flat[i].label, opts[i].label, `option order broken at index ${i}`);
      }

      // Sanity: last page must hold >= 2 options (AskUserQuestion minItems=2).
      const last = r.pages[r.pages.length - 1];
      assert.ok(last.options.length >= 2, `last page must have >=2 options; got ${last.options.length}`);
    });
  }

  it('N=5 produces exactly [3+nav][2]', () => {
    const r = PICKER.paginate(makeOptions(5));
    assert.strictEqual(r.pages.length, 2);
    assert.strictEqual(r.pages[0].options.length, 4);
    assert.strictEqual(r.pages[0].options[3].__nav, true);
    assert.strictEqual(r.pages[1].options.length, 2);
  });

  it('N=7 produces [3+nav][2+nav][2] (avoids leaving a 1-option last page)', () => {
    const r = PICKER.paginate(makeOptions(7));
    assert.strictEqual(r.pages.length, 3);
    assert.strictEqual(r.pages[0].options.length, 4);
    assert.strictEqual(r.pages[1].options.length, 3);
    assert.strictEqual(r.pages[1].options[2].__nav, true);
    assert.strictEqual(r.pages[2].options.length, 2);
  });

  it('N=8 produces [3+nav][3+nav][2]', () => {
    const r = PICKER.paginate(makeOptions(8));
    assert.strictEqual(r.pages.length, 3);
    assert.strictEqual(r.pages[0].options.length, 4);
    assert.strictEqual(r.pages[1].options.length, 4);
    assert.strictEqual(r.pages[1].options[3].__nav, true);
    assert.strictEqual(r.pages[2].options.length, 2);
  });

  it('N=12 produces four pages, last page has 3 options', () => {
    const r = PICKER.paginate(makeOptions(12));
    assert.strictEqual(r.pages.length, 4);
    assert.strictEqual(r.pages[3].options.length, 3);
  });
});

describe('picker.paginate — nav label customization', () => {
  it('uses custom nav-label / nav-description when provided', () => {
    const r = PICKER.paginate(makeOptions(6), {
      navLabel: 'Show more areas →',
      navDescription: 'Show more gray areas to choose from',
    });
    const nav = r.pages[0].options[r.pages[0].options.length - 1];
    assert.strictEqual(nav.label, 'Show more areas →');
    assert.strictEqual(nav.description, 'Show more gray areas to choose from');
    assert.strictEqual(nav.__nav, true);
  });

  it('defaults nav-label to "Show more options →" when not provided', () => {
    const r = PICKER.paginate(makeOptions(5));
    const nav = r.pages[0].options[3];
    assert.strictEqual(nav.label, 'Show more options →');
  });
});

describe('picker.partitionSelections', () => {
  it('splits nav sentinel out of selections', () => {
    const nav = { label: 'Show more areas →', __nav: true };
    const a = { label: 'Layout style' };
    const b = { label: 'Loading behavior' };
    const r = PICKER.partitionSelections([a, nav, b]);
    assert.deepStrictEqual(r.picked.map(p => p.label), ['Layout style', 'Loading behavior']);
    assert.strictEqual(r.advance, true);
  });

  it('detects nav by label even if __nav field is stripped', () => {
    const r = PICKER.partitionSelections([{ label: 'Show more options →' }, { label: 'X' }]);
    assert.strictEqual(r.advance, true);
    assert.deepStrictEqual(r.picked.map(p => p.label), ['X']);
  });

  it('returns advance=false when no nav option present', () => {
    const r = PICKER.partitionSelections([{ label: 'X' }, { label: 'Y' }]);
    assert.strictEqual(r.advance, false);
    assert.strictEqual(r.picked.length, 2);
  });

  it('handles non-array input gracefully', () => {
    const r = PICKER.partitionSelections(null);
    assert.deepStrictEqual(r, { picked: [], advance: false });
  });
});

describe('picker via forge-tools CLI', () => {
  function runCli(args) {
    const res = spawnSync(process.execPath, [FORGE_TOOLS].concat(args), { encoding: 'utf8' });
    return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  }

  it('paginate subcommand returns JSON matching the library', () => {
    const opts = makeOptions(7);
    const cliRes = runCli(['picker', 'paginate', '--options', JSON.stringify(opts)]);
    assert.strictEqual(cliRes.code, 0, `CLI failed: ${cliRes.stderr}`);
    const parsed = JSON.parse(cliRes.stdout);
    const libRes = PICKER.paginate(opts);
    assert.strictEqual(parsed.pages.length, libRes.pages.length);
    assert.strictEqual(parsed.total, libRes.total);
    for (let i = 0; i < parsed.pages.length; i++) {
      assert.strictEqual(parsed.pages[i].options.length, libRes.pages[i].options.length);
      assert.strictEqual(parsed.pages[i].isLast, libRes.pages[i].isLast);
    }
  });

  it('paginate subcommand honors --nav-label flag', () => {
    const opts = makeOptions(5);
    const cliRes = runCli([
      'picker', 'paginate',
      '--options', JSON.stringify(opts),
      '--nav-label', 'Show more areas →',
      '--nav-description', 'More gray areas',
    ]);
    assert.strictEqual(cliRes.code, 0, `CLI failed: ${cliRes.stderr}`);
    const parsed = JSON.parse(cliRes.stdout);
    const nav = parsed.pages[0].options[3];
    assert.strictEqual(nav.label, 'Show more areas →');
    assert.strictEqual(nav.description, 'More gray areas');
    assert.strictEqual(nav.__nav, true);
  });

  it('paginate subcommand errors when --options is missing', () => {
    const cliRes = runCli(['picker', 'paginate']);
    assert.notStrictEqual(cliRes.code, 0);
    assert.ok(/Usage/.test(cliRes.stderr) || /Usage/.test(cliRes.stdout));
  });

  it('paginate subcommand errors when --options is not valid JSON', () => {
    const cliRes = runCli(['picker', 'paginate', '--options', 'not-json']);
    assert.notStrictEqual(cliRes.code, 0);
    assert.ok(/not valid JSON/.test(cliRes.stderr));
  });
});
