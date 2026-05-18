'use strict';

/**
 * SAML identity adapter (stub).
 *
 * SAML assertion handling requires an external IdP and ds:Signature
 * verification; this stub exposes the same surface as `local` / `oidc` so
 * configuration-driven dispatch never throws. Customers wanting SAML auth
 * provide their own implementation via `identity.adapter = "saml"` after
 * dropping a replacement at `.forge/identity-adapter.js`.
 */

function actor(/* cwd */) {
  return process.env.FORGE_SAML_SUBJECT || 'anonymous';
}

function publicKeyPem(/* cwd */) { return null; }
function signHex(/* cwd, hex */) { return null; }

module.exports = { actor, publicKeyPem, signHex };
