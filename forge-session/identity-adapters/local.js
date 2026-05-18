'use strict';

/**
 * Local Ed25519 identity adapter (passthrough wrapper to the default behaviour
 * already implemented in identity.js — kept here so adapterName='local' has a
 * loadable module).
 */

const identity = require('../identity');

module.exports = {
  actor: identity.actor,
  publicKeyPem: identity.publicKeyPem,
  signHex: identity.signHex,
};
