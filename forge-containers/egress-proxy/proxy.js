#!/usr/bin/env node
'use strict';

/**
 * forge-containers/egress-proxy/proxy.js
 *
 * Minimal HTTP/HTTPS forward proxy with destination allowlist.
 *
 * Modes (read once at startup from --policy file):
 *   - strict:   only domains in `allow:` list, no wildcards beyond `*.example.com`
 *   - build:    strict + package registries
 *   - research: strict + build + docs hosts
 *
 * Usage:
 *   node proxy.js --port 8228 --policy ./profiles/strict.yaml [--log /var/log/forge-egress.log]
 *
 * Designed to run in Docker on a user-defined bridge `forge-egress`. Agent
 * containers join that network with HTTP(S)_PROXY pointing here.
 */

const http = require('http');
const net = require('net');
const fs = require('fs');
const url = require('url');
const path = require('path');

// ── Args ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { port: 8228, policy: null, log: null, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--policy') out.policy = argv[++i];
    else if (a === '--log') out.log = argv[++i];
    else if (a === '--verbose') out.verbose = true;
  }
  return out;
}

// ── Policy ────────────────────────────────────────────────────────
function parseTinyYaml(text) {
  const out = { mode: 'strict', allow: [], deny: [] };
  let section = null;
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/#.*$/, '').replace(/\s+$/g, '');
    if (!trimmed.trim()) continue;
    const kv = trimmed.match(/^(mode|allow|deny)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const val = kv[2].trim();
      if (val === '' || val === '|' || val === '>-') { section = key; continue; }
      if (val.startsWith('[') && val.endsWith(']')) {
        out[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        section = null;
        continue;
      }
      out[key] = val.replace(/^["']|["']$/g, '');
      section = null;
      continue;
    }
    const item = trimmed.match(/^\s*-\s*(.+)$/);
    if (item && section && Array.isArray(out[section])) {
      out[section].push(item[1].replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

function loadPolicy(policyPath) {
  if (!policyPath || !fs.existsSync(policyPath)) {
    return { mode: 'strict', allow: [], deny: [] };
  }
  try { return parseTinyYaml(fs.readFileSync(policyPath, 'utf8')); }
  catch { return { mode: 'strict', allow: [], deny: [] }; }
}

function hostMatches(host, pattern) {
  if (!host || !pattern) return false;
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(1);   // .example.com
    return h === suffix.slice(1) || h.endsWith(suffix);
  }
  return h === p;
}

function isAllowed(host, policy) {
  if (!host) return false;
  for (const d of policy.deny || []) if (hostMatches(host, d)) return false;
  for (const a of policy.allow || []) if (hostMatches(host, a)) return true;
  return false;
}

// ── Logging ───────────────────────────────────────────────────────
function makeLogger(logPath, verbose) {
  const stream = logPath ? fs.createWriteStream(logPath, { flags: 'a' }) : null;
  return function log(line) {
    const ts = new Date().toISOString();
    const msg = `[${ts}] ${line}\n`;
    if (stream) stream.write(msg);
    if (verbose || !stream) process.stdout.write(msg);
  };
}

// ── Server ────────────────────────────────────────────────────────
function start(args) {
  const policy = loadPolicy(args.policy);
  const log = makeLogger(args.log, args.verbose);
  log(`forge-egress-proxy starting on :${args.port} (mode=${policy.mode}, allow=${(policy.allow || []).length})`);

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url);
    const host = parsed.hostname || (req.headers.host || '').split(':')[0];
    if (!isAllowed(host, policy)) {
      log(`DENY ${req.method} ${host}`);
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('egress denied by policy\n');
      return;
    }
    log(`ALLOW ${req.method} ${host}`);
    const fwdReq = http.request({
      host,
      port: parsed.port || 80,
      method: req.method,
      path: parsed.path,
      headers: req.headers,
    }, (fwdRes) => {
      res.writeHead(fwdRes.statusCode, fwdRes.headers);
      fwdRes.pipe(res);
    });
    fwdReq.on('error', (e) => {
      log(`ERR ${host}: ${e.message}`);
      try { res.writeHead(502); res.end('upstream error\n'); } catch {}
    });
    req.pipe(fwdReq);
  });

  // HTTPS CONNECT tunneling
  server.on('connect', (req, clientSocket, head) => {
    const [host, port] = (req.url || '').split(':');
    if (!isAllowed(host, policy)) {
      log(`DENY CONNECT ${host}`);
      try {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        clientSocket.end();
      } catch {}
      return;
    }
    log(`ALLOW CONNECT ${host}`);
    const upstream = net.connect(Number(port) || 443, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', (e) => {
      log(`ERR CONNECT ${host}: ${e.message}`);
      try { clientSocket.end(); } catch {}
    });
    clientSocket.on('error', () => { try { upstream.end(); } catch {} });
  });

  server.listen(args.port, '0.0.0.0', () => {
    log(`listening :${args.port}`);
  });
  return server;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  start(args);
}

module.exports = { start, loadPolicy, isAllowed, hostMatches, parseTinyYaml };
