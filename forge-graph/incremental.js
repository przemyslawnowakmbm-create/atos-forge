// @ts-check
'use strict';

/**
 * forge-graph/incremental.js  (P5 / 4.3.4)
 *
 * Batches graph updates by minute-level windows when called repeatedly
 * in CI or short-lived hooks. Each call records the requested `--since`
 * window in `.forge/cache/incremental-state.json`; when the next call
 * arrives inside the cooldown, we coalesce it into the running batch
 * instead of running a full updater.
 *
 * Usage:
 *   const inc = require('./incremental');
 *   await inc.scheduleUpdate(cwd, { since: 'HEAD~1' });
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_WINDOW_MS = 60 * 1000;   // 1 minute coalescing window
const STATE_FILE = 'incremental-state.json';

function stateDir(cwd) { return path.join(cwd, '.forge', 'cache'); }
function statePath(cwd) { return path.join(stateDir(cwd), STATE_FILE); }

function _readState(cwd) {
  try { return JSON.parse(fs.readFileSync(statePath(cwd), 'utf8')); }
  catch { return null; }
}
function _writeState(cwd, state) {
  if (!fs.existsSync(stateDir(cwd))) fs.mkdirSync(stateDir(cwd), { recursive: true });
  fs.writeFileSync(statePath(cwd), JSON.stringify(state, null, 2));
}

/**
 * Schedule an incremental update. Returns one of:
 *   { status: 'coalesced', batch_id, sinceList }
 *   { status: 'started',  batch_id, sinceList }
 *
 * Coalescing rules:
 *   - If the previous batch is younger than the cooldown window, just
 *     append `since` to its list and persist (the next caller — usually
 *     a long-lived process or cron — handles the actual run).
 *   - Otherwise, mark a new batch as active.
 */
async function scheduleUpdate(cwd, opts = {}) {
  const since = opts.since || 'HEAD~1';
  const window = typeof opts.window_ms === 'number' ? opts.window_ms : DEFAULT_WINDOW_MS;
  const now = Date.now();

  const state = _readState(cwd) || { batches: [] };
  const last = state.batches[state.batches.length - 1];

  if (last && (now - last.started_at) < window && last.status === 'pending') {
    if (!last.sinceList.includes(since)) last.sinceList.push(since);
    last.last_request_at = now;
    _writeState(cwd, state);
    return { status: 'coalesced', batch_id: last.id, sinceList: last.sinceList.slice() };
  }

  const id = `inc-${now.toString(36)}`;
  const batch = { id, started_at: now, last_request_at: now, status: 'pending', sinceList: [since] };
  state.batches.push(batch);
  // Cap history at 20 batches.
  if (state.batches.length > 20) state.batches = state.batches.slice(-20);
  _writeState(cwd, state);
  return { status: 'started', batch_id: id, sinceList: batch.sinceList.slice() };
}

/**
 * Run the actual updater for a coalesced batch. Looks up the latest
 * pending batch in state and invokes GraphUpdater with the union of
 * `since` markers (using the broadest range).
 */
async function flushPending(cwd) {
  const state = _readState(cwd);
  if (!state || state.batches.length === 0) return { ran: false, reason: 'no-state' };
  const idx = state.batches.findLastIndex
    ? state.batches.findLastIndex(b => b.status === 'pending')
    : (() => {
        for (let i = state.batches.length - 1; i >= 0; i--) {
          if (state.batches[i].status === 'pending') return i;
        }
        return -1;
      })();
  if (idx === -1) return { ran: false, reason: 'no-pending' };

  const batch = state.batches[idx];
  let updater;
  try {
    const mod = require('./updater');
    updater = mod.GraphUpdater || mod['default'] || mod;
  } catch {
    return { ran: false, reason: 'no-updater' };
  }

  // Pick the widest `since` (oldest commit ref).  We can't easily compare
  // refs without a git probe, so just run once per distinct ref and let
  // the underlying updater de-dup. In practice the coalesced list is small.
  const ran = [];
  for (const since of batch.sinceList) {
    try {
      const u = new updater(cwd);
      await u.update({ since });
      ran.push(since);
    } catch (err) {
      // Mark batch failed but still progress through siblings.
      batch.errors = batch.errors || [];
      batch.errors.push(String(err && err.message || err));
    }
  }
  batch.status = batch.errors && batch.errors.length === batch.sinceList.length ? 'failed' : 'done';
  batch.finished_at = Date.now();
  _writeState(cwd, state);
  return { ran: true, batch_id: batch.id, sinceCount: ran.length, errors: batch.errors || [] };
}

module.exports = { scheduleUpdate, flushPending, DEFAULT_WINDOW_MS };
