'use strict';

/**
 * tests/e2e/report.cjs
 *
 * HTML report generator. Consumes the per-project ledger JSONs in
 * tests/e2e/reports/ plus the summary.json and emits an index.html with
 * pass/fail badges, per-step detail, and aggregate totals.
 */

const fs = require('fs');
const path = require('path');

const FDP_ROOT = path.resolve(__dirname, '..', '..');
const IMPROVEMENTS_MD = path.join(FDP_ROOT, 'improvements.md');

function _h(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _summarisePhases() {
  if (!fs.existsSync(IMPROVEMENTS_MD)) return null;
  const md = fs.readFileSync(IMPROVEMENTS_MD, 'utf8');
  const lines = md.split('\n');
  const phases = [];
  for (const ln of lines) {
    const m = ln.match(/^##\s+P(\d+)[\s:.\-]+(.+?)$/i);
    if (m) phases.push({ id: 'P' + m[1], title: m[2].trim() });
  }
  return phases.slice(0, 12);
}

function _badge(pass, fail) {
  const ok = fail === 0;
  const colour = ok ? '#16a34a' : '#dc2626';
  const label = ok ? 'PASS' : 'FAIL';
  return `<span class="badge" style="background:${colour}">${label}</span>` +
         `<span class="counts">${pass} pass / ${fail} fail</span>`;
}

function _phaseChips(phases) {
  if (!phases || phases.length === 0) return '';
  return phases.map(p =>
    `<span class="chip" title="${_h(p.title)}">${_h(p.id)}: ${_h(p.title)}</span>`
  ).join(' ');
}

function _projectSection(ledger) {
  const verdict = ledger.fail === 0 ? 'pass' : 'fail';
  const steps = ledger.steps.map(s => {
    const c = s.status === 'pass' ? 'pass' : 'fail';
    const detail = s.detail ? `<div class="detail">${_h(s.detail)}</div>` : '';
    const stderr = s.stderr ? `<details><summary>stderr</summary><pre>${_h(s.stderr)}</pre></details>` : '';
    return `<li class="step ${c}">
      <span class="step-status">${s.status.toUpperCase()}</span>
      <span class="step-name">${_h(s.name)}</span>
      ${detail}
      ${stderr}
    </li>`;
  }).join('');
  const duration = ledger.finished_at && ledger.started_at
    ? Math.max(0, new Date(ledger.finished_at) - new Date(ledger.started_at))
    : 0;
  return `<section class="project ${verdict}">
    <header>
      <h2>${_h(ledger.name)}</h2>
      ${_badge(ledger.pass, ledger.fail)}
      <span class="dur">${duration} ms</span>
    </header>
    <ol class="steps">${steps}</ol>
  </section>`;
}

function _html({ summary, reports, phases, version }) {
  const v = version || '';
  const ok = summary.totals.fail === 0;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forge — E2E Test Report</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         margin: 0; padding: 24px; background: #fafafa; color: #111; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b0b0b; color: #e5e5e5; }
    section.project { background: #161616; border-color: #222; }
    pre { background: #0e0e0e; border-color: #222; }
    .meta { color: #888; }
    .step .detail { color: #888; }
  }
  h1 { margin: 0 0 8px; font-size: 26px; }
  .meta { color: #555; margin-bottom: 18px; }
  .summary-card { padding: 18px 22px; border-radius: 12px;
                  background: ${ok ? '#16a34a22' : '#dc262622'};
                  border: 1px solid ${ok ? '#16a34a44' : '#dc262644'};
                  margin-bottom: 18px; display: flex; gap: 28px; flex-wrap: wrap; }
  .summary-card .stat { font-size: 28px; font-weight: 600; }
  .summary-card .label { display: block; font-size: 11px;
                         text-transform: uppercase; letter-spacing: 1px; color: #666; }
  .chip { display: inline-block; padding: 4px 10px; margin: 2px 4px 2px 0;
          background: #2e3a4f; color: #fff; border-radius: 12px; font-size: 11px; }
  section.project { background: #fff; border: 1px solid #e5e5e5;
                    border-radius: 10px; padding: 16px 18px;
                    margin: 12px 0; }
  section.project header { display: flex; align-items: center;
                           gap: 12px; flex-wrap: wrap; }
  section.project h2 { margin: 0; font-size: 17px; }
  .badge { padding: 3px 10px; border-radius: 6px; color: #fff;
           font-size: 11px; letter-spacing: 1px; font-weight: 600; }
  .counts { font-size: 12px; color: #666; }
  .dur { margin-left: auto; font-size: 12px; color: #999; }
  ol.steps { list-style: none; padding: 0; margin: 12px 0 0; }
  .step { display: grid;
          grid-template-columns: 56px 1fr;
          gap: 10px; padding: 6px 0; border-top: 1px dotted #e5e5e5; align-items: start; }
  .step.pass .step-status { color: #16a34a; }
  .step.fail .step-status { color: #dc2626; font-weight: 600; }
  .step-status { font-size: 11px; padding-top: 2px; }
  .step-name { font-family: ui-monospace, "SF Mono", monospace; font-size: 13px; }
  .step .detail { color: #666; font-size: 12px; grid-column: 2; }
  .step pre { background: #f6f6f6; border: 1px solid #eee; border-radius: 6px;
              padding: 6px 8px; font-size: 12px; max-height: 240px; overflow: auto; }
  details { grid-column: 2; }
  footer { margin-top: 24px; font-size: 11px; color: #999; text-align: center; }
</style>
</head>
<body>
<h1>Forge — End-to-End Test Report</h1>
<div class="meta">
  Generated ${_h(new Date().toISOString())} ${v ? ' · ' + _h(v) : ''}
</div>

<div class="summary-card">
  <div><span class="label">Projects</span>
       <span class="stat">${summary.totals.projectsPassed}/${summary.totals.projects}</span></div>
  <div><span class="label">Assertions</span>
       <span class="stat">${summary.totals.pass}</span></div>
  <div><span class="label">Failures</span>
       <span class="stat">${summary.totals.fail}</span></div>
  <div><span class="label">Verdict</span>
       <span class="stat" style="color:${ok ? '#16a34a' : '#dc2626'}">${ok ? 'PASS' : 'FAIL'}</span></div>
</div>

${phases ? `<div class="meta">Improvements covered: ${_phaseChips(phases)}</div>` : ''}

${reports.map(_projectSection).join('\n')}

<footer>Forge E2E suite · ${_h(new Date().toISOString())}</footer>
</body>
</html>`;
}

function renderReport({ summary, reports, reportsDir }) {
  const phases = _summarisePhases();
  let version = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(FDP_ROOT, 'package.json'), 'utf8'));
    version = `forge-cli v${pkg.version}`;
  } catch { /* ignore */ }
  const html = _html({ summary, reports, phases, version });
  const out = path.join(reportsDir, 'index.html');
  fs.writeFileSync(out, html);
  return out;
}

if (require.main === module) {
  // Standalone invocation: discover reports/*.json and render.
  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) {
    process.stderr.write(`No reports dir at ${reportsDir}\n`);
    process.exit(1);
  }
  const summaryPath = path.join(reportsDir, 'summary.json');
  let summary;
  if (fs.existsSync(summaryPath)) {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } else {
    summary = { totals: { pass: 0, fail: 0, projects: 0, projectsPassed: 0 } };
  }
  const reports = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith('project') && f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf8')));
  const out = renderReport({ summary, reports, reportsDir });
  process.stdout.write(`Wrote ${out}\n`);
}

module.exports = { renderReport };
