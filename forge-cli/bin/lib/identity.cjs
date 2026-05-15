'use strict';

/**
 * Identity CLI — wraps forge-session/identity.js.
 *
 * Subcommands:
 *   init      — ensure local Ed25519 keypair exists under .forge/identity/
 *   show      — print actor, fingerprint, adapter, paths
 *   pubkey    — print the public key PEM
 *   adapter   — print configured adapter name
 */

const path = require('path');
const { output, error, getForgeRoot } = require('./core.cjs');

async function handleIdentity(cwd, args, raw) {
  const id = require(path.join(getForgeRoot(), 'forge-session', 'identity'));
  const sub = (args[0] || 'show').toLowerCase();

  try {
    if (sub === 'init') {
      const r = id.ensureLocalKeypair(cwd);
      if (raw) return output(r, raw);
      console.log(`${r.created ? 'Created' : 'Reused'} identity for ${r.actor}`);
      console.log(`  fingerprint: ${r.publicKeyFingerprint}`);
      console.log(`  path: ${id.identityDir(cwd)}`);
      return;
    }

    if (sub === 'show') {
      const info = {
        actor: id.actor(cwd),
        adapter: id.adapterName(cwd),
        public_key_path: id.pubPath(cwd),
        private_key_path: id.privPath(cwd),
        meta_path: id.metaPath(cwd),
      };
      if (raw) return output(info, raw);
      console.log(`actor:       ${info.actor}`);
      console.log(`adapter:     ${info.adapter}`);
      console.log(`public key:  ${info.public_key_path}`);
      console.log(`private key: ${info.private_key_path}`);
      return;
    }

    if (sub === 'pubkey') {
      const pem = id.publicKeyPem(cwd);
      if (!pem) { error('No public key available.'); return; }
      process.stdout.write(pem);
      return;
    }

    if (sub === 'adapter') {
      const name = id.adapterName(cwd);
      if (raw) return output({ adapter: name }, raw);
      console.log(name);
      return;
    }

    error('Unknown identity subcommand. Available: init, show, pubkey, adapter');
  } catch (e) {
    error('Identity error: ' + e.message);
  }
}

module.exports = { handleIdentity };
