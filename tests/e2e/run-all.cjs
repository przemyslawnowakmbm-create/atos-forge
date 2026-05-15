#!/usr/bin/env node
'use strict';

/**
 * tests/e2e/run-all.cjs
 *
 * Orchestrator: invokes every project*.cjs simulation in sequence, aggregates
 * the per-project JSON ledgers, writes a summary, and triggers the HTML
 * report generator.
 *
 * Exit code: 0 if every project's `fail` count is zero, 1 otherwise.
 */

const fs = require('fs');
const path = require('path');

const E2E_DIR = __dirname;
const REPORT_DIR = path.join(E2E_DIR, 'reports');

function listProjects() {
  return fs.readdirSync(E2E_DIR)
    .filter(f => /^project\d+\..*\.cjs$/.test(f))
    .sort();
}

function header(name) {
  const bar = '═'.repeat(72);
  process.stdout.write(`\n${bar}\n  ${name}\n${bar}\n`);
}

function summarize(reports) {
  const totals = { pass: 0, fail: 0, projects: 0, projectsPassed: 0 };
  for (const r of reports) {
    totals.projects++;
    totals.pass += r.pass;
    totals.fail += r.fail;
    if (r.fail === 0) totals.projectsPassed++;
  }
  return totals;
}

function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const projects = listProjects();
  const reports = [];
  const startedAt = new Date().toISOString();

  for (const file of projects) {
    header(file);
    const abs = path.join(E2E_DIR, file);
    const mod = require(abs);
    if (typeof mod.run !== 'function') {
      process.stderr.write(`SKIP ${file}: no run() export\n`); continue;
    }
    let ledger;
    try { ledger = mod.run(); }
    catch (err) {
      process.stderr.write(`FATAL ${file}: ${err.message}\n`);
      ledger = { name: file.replace(/\.cjs$/, ''),
        pass: 0, fail: 1, started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        steps: [{ name: 'fatal', status: 'fail', detail: String(err.message), ts: new Date().toISOString() }] };
    }
    reports.push(ledger);
    const verdict = ledger.fail === 0 ? 'PASS' : 'FAIL';
    process.stdout.write(`  ${verdict}  pass=${ledger.pass}  fail=${ledger.fail}\n`);
  }

  const totals = summarize(reports);
  const finishedAt = new Date().toISOString();
  const summary = {
    started_at: startedAt,
    finished_at: finishedAt,
    totals,
    projects: reports.map(r => ({
      name: r.name,
      pass: r.pass,
      fail: r.fail,
      started_at: r.started_at,
      finished_at: r.finished_at,
    })),
  };
  fs.writeFileSync(path.join(REPORT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2));

  header('SUMMARY');
  process.stdout.write(`  projects: ${totals.projectsPassed}/${totals.projects} passed\n`);
  process.stdout.write(`  asserts:  ${totals.pass} pass / ${totals.fail} fail\n`);
  process.stdout.write(`  reports:  ${path.relative(process.cwd(), REPORT_DIR)}\n\n`);

  // Render HTML report.
  try {
    const { renderReport } = require('./report.cjs');
    const htmlPath = renderReport({ summary, reports, reportsDir: REPORT_DIR });
    process.stdout.write(`  HTML:     ${path.relative(process.cwd(), htmlPath)}\n\n`);
  } catch (err) {
    process.stderr.write(`HTML report generation failed: ${err.message}\n`);
  }

  process.exit(totals.fail === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { listProjects };
