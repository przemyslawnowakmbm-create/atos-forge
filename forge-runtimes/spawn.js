'use strict';

/**
 * forge-runtimes/spawn.js  (P8 / 4.5.3)
 *
 * Generic safe spawn for a runtime invocation. Uses execFile-style argv;
 * never composes shell strings. Caller is responsible for binary discovery
 * (forge-agents/provider.js handles that via PATH probing).
 */

const { spawn } = require('child_process');

function run(bin, invocation, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const child = spawn(bin, invocation.args || [], {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...(invocation.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    if (invocation.stdin != null) {
      try { child.stdin.write(invocation.stdin); child.stdin.end(); }
      catch { /* child already gone */ }
    } else {
      try { child.stdin.end(); } catch { /* ignore */ }
    }
    let killTimer = null;
    if (opts.timeoutMs && Number.isFinite(opts.timeoutMs)) {
      killTimer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
      }, opts.timeoutMs);
    }
    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, signal, stdout: out, stderr: err });
    });
    child.on('error', (e) => {
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: -1, signal: null, stdout: out, stderr: err + String(e && e.message || e) });
    });
  });
}

module.exports = { run };
