'use strict';

/**
 * OIDC identity adapter.
 *
 * Reads an OIDC ID token from FORGE_OIDC_TOKEN (a JWT). Uses the JWT `sub`
 * (or `email` if present) as the actor. No signing is performed; the audit
 * record carries no `sig` for OIDC mode (the OIDC issuer is the trust root).
 *
 * Verification of the JWT itself is intentionally out of scope here — full
 * issuer-pubkey validation belongs in an enterprise integration. We only
 * extract the principal and trust the CI environment to inject a token.
 */

function getToken() {
  const tok = process.env.FORGE_OIDC_TOKEN || '';
  if (!tok || typeof tok !== 'string') return null;
  return tok.trim();
}

function decodePayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch { return null; }
}

function actor(/* cwd */) {
  const tok = getToken();
  if (!tok) return 'anonymous';
  const claims = decodePayload(tok);
  if (!claims) return 'anonymous';
  return claims.email || claims.preferred_username || claims.sub || 'anonymous';
}

function publicKeyPem(/* cwd */) { return null; }

function signHex(/* cwd, hex */) { return null; }

module.exports = { actor, publicKeyPem, signHex };
