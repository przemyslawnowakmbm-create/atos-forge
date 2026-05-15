'use strict';

/**
 * forge-session/identity.js
 *
 * Project identity for audit signing. Default adapter: `local`.
 *
 * Local adapter: Ed25519 keypair under `.forge/identity/`
 *   private.pem  (0600, gitignored)
 *   public.pem   (committable)
 *   identity.json { actor, created_at, public_key_fingerprint }
 *
 * Other adapters (OIDC, SAML) are stubbed in identity-adapters/ and selected
 * via config `identity.adapter`. They share the same surface: actor(cwd),
 * signHex(cwd, hex), publicKeyPem(cwd).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSafe } = require('../forge-cli/lib/exec');

function identityDir(cwd) { return path.join(cwd, '.forge', 'identity'); }
function privPath(cwd)    { return path.join(identityDir(cwd), 'private.pem'); }
function pubPath(cwd)     { return path.join(identityDir(cwd), 'public.pem'); }
function metaPath(cwd)    { return path.join(identityDir(cwd), 'identity.json'); }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function gitUserEmail(cwd) {
  try {
    const out = execFileSafe('git', ['config', '--get', 'user.email'], { cwd, allowFailure: true });
    return (out && out.trim()) || null;
  } catch { return null; }
}

function adapterName(cwd) {
  try {
    const cfg = require('../forge-config/config');
    const { config } = cfg.loadConfig(cwd);
    if (config.identity && typeof config.identity.adapter === 'string') return config.identity.adapter;
  } catch { /* default */ }
  return 'local';
}

function loadAdapter(name) {
  try {
    return require(path.join(__dirname, 'identity-adapters', name));
  } catch { return null; }
}

/**
 * Ensure a local Ed25519 keypair exists. Idempotent.
 * Returns { created: bool, actor, publicKeyFingerprint }.
 */
function ensureLocalKeypair(cwd) {
  ensureDir(identityDir(cwd));
  let created = false;
  if (!fs.existsSync(privPath(cwd)) || !fs.existsSync(pubPath(cwd))) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privPath(cwd), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(pubPath(cwd),  publicKey.export({ type: 'spki', format: 'pem' }));
    created = true;
  }
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath(cwd), 'utf8')); } catch { /* fresh */ }
  if (!meta.actor || created) {
    meta = {
      actor: gitUserEmail(cwd) || `local:${path.basename(cwd)}`,
      created_at: meta.created_at || new Date().toISOString(),
      public_key_fingerprint: fingerprint(fs.readFileSync(pubPath(cwd), 'utf8')),
    };
    fs.writeFileSync(metaPath(cwd), JSON.stringify(meta, null, 2) + '\n');
  }
  return { created, actor: meta.actor, publicKeyFingerprint: meta.public_key_fingerprint };
}

function fingerprint(pem) {
  const der = pemToDer(pem);
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
}

function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  return Buffer.from(body, 'base64');
}

function actor(cwd) {
  const name = adapterName(cwd);
  if (name !== 'local') {
    const ad = loadAdapter(name);
    if (ad && typeof ad.actor === 'function') return ad.actor(cwd);
  }
  if (!fs.existsSync(metaPath(cwd))) {
    return gitUserEmail(cwd) || 'anonymous';
  }
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath(cwd), 'utf8'));
    return meta.actor || 'anonymous';
  } catch { return 'anonymous'; }
}

function publicKeyPem(cwd) {
  const name = adapterName(cwd);
  if (name !== 'local') {
    const ad = loadAdapter(name);
    if (ad && typeof ad.publicKeyPem === 'function') return ad.publicKeyPem(cwd);
  }
  if (!fs.existsSync(pubPath(cwd))) return null;
  try { return fs.readFileSync(pubPath(cwd), 'utf8'); } catch { return null; }
}

function signHex(cwd, hexString) {
  if (typeof hexString !== 'string' || !/^[0-9a-f]+$/i.test(hexString)) return null;
  const name = adapterName(cwd);
  if (name !== 'local') {
    const ad = loadAdapter(name);
    if (ad && typeof ad.signHex === 'function') return ad.signHex(cwd, hexString);
    return null;
  }
  if (!fs.existsSync(privPath(cwd))) return null;
  try {
    const priv = crypto.createPrivateKey(fs.readFileSync(privPath(cwd)));
    const sig = crypto.sign(null, Buffer.from(hexString, 'hex'), priv);
    return sig.toString('base64');
  } catch { return null; }
}

module.exports = { ensureLocalKeypair, actor, publicKeyPem, signHex, identityDir, pubPath, privPath, metaPath, adapterName };
