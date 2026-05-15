#!/usr/bin/env node
'use strict';

/**
 * scripts/sbom.js  (P6 / 4.4.5)
 *
 * Generate a CycloneDX-shaped SBOM from package-lock.json. We deliberately do
 * NOT shell out to `npm sbom` because that command requires npm >=10 and is
 * not always available on the runner; this script reads the lockfile and
 * emits a minimal CycloneDX v1.5 JSON document.
 *
 * Output: .github/releases/sbom-<version>.json
 *
 * Usage:
 *   node scripts/sbom.js
 *   node scripts/sbom.js --out path/to/sbom.json
 *   node scripts/sbom.js --stdout
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function purl(name, version) {
  // pkg:npm/<name>@<version>  (handles scoped names)
  return `pkg:npm/${encodeURIComponent(name).replace('%40', '@').replace('%2F', '/')}@${encodeURIComponent(version)}`;
}

function componentsFromLockfile(lock) {
  const components = [];
  if (!lock.packages) return components;
  for (const [pkgPath, entry] of Object.entries(lock.packages)) {
    if (!pkgPath || pkgPath === '') continue; // root
    const name = entry.name || pkgPath.split('node_modules/').slice(-1)[0];
    const version = entry.version;
    if (!name || !version) continue;
    const c = {
      type: 'library',
      name,
      version,
      purl: purl(name, version),
    };
    if (entry.integrity) {
      const [alg, b64] = entry.integrity.split('-');
      if (alg && b64) {
        c.hashes = [{ alg: alg.toUpperCase().replace('SHA', 'SHA-'), content: Buffer.from(b64, 'base64').toString('hex') }];
      }
    }
    if (entry.license) c.licenses = [{ license: { id: entry.license } }];
    components.push(c);
  }
  // dedupe by purl
  const seen = new Set();
  return components.filter(c => (seen.has(c.purl) ? false : (seen.add(c.purl), true)));
}

function buildSbom(repoRoot) {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const lock = (() => {
    try { return readJson(path.join(repoRoot, 'package-lock.json')); }
    catch { return { packages: {} }; }
  })();
  const components = componentsFromLockfile(lock);
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'forge', name: 'forge-sbom', version: '1.0.0' }],
      component: {
        type: 'application',
        name: pkg.name,
        version: pkg.version,
        purl: purl(pkg.name, pkg.version),
        licenses: pkg.license ? [{ license: { id: pkg.license } }] : [],
      },
    },
    components,
  };
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const repoRoot = rootIdx !== -1
    ? path.resolve(argv[rootIdx + 1])
    : path.resolve(__dirname, '..');
  const sbom = buildSbom(repoRoot);
  const stdout = argv.includes('--stdout');
  const outIdx = argv.indexOf('--out');
  const outArg = outIdx !== -1 ? argv[outIdx + 1] : null;
  const json = JSON.stringify(sbom, null, 2);
  if (stdout) {
    process.stdout.write(json + '\n');
    return;
  }
  const releasesDir = path.join(repoRoot, '.github', 'releases');
  if (!fs.existsSync(releasesDir)) fs.mkdirSync(releasesDir, { recursive: true });
  const version = readJson(path.join(repoRoot, 'package.json')).version;
  const outPath = outArg
    ? path.resolve(repoRoot, outArg)
    : path.join(releasesDir, `sbom-${version}.json`);
  fs.writeFileSync(outPath, json);
  // eslint-disable-next-line no-console
  console.log(`Wrote SBOM: ${path.relative(repoRoot, outPath)}  (${sbom.components.length} components)`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { buildSbom, componentsFromLockfile, purl };
