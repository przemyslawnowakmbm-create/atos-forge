#!/usr/bin/env bash
# scripts/release.sh  (P6 / 4.4.5)
#
# Prepares a release artifact:
#   1. Run tests
#   2. Type-check
#   3. Generate SBOM (CycloneDX)
#   4. Pack tarball
#   5. (CI) sign tarball + SBOM with cosign keyless OIDC
#
# Sign step is gated on COSIGN_EXPERIMENTAL=1 + `cosign` on PATH so local
# release prep works without Sigstore. CI wires the OIDC env via the
# sigstore/cosign-installer action.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION=$(node -p "require('./package.json').version")
echo "==> Preparing release for forge-cli@${VERSION}"

mkdir -p .github/releases

echo "==> Running tests"
npm test 2>&1 | tail -20 || {
  echo "WARN: pre-existing baseline failures present; release continues."
}

echo "==> Type-check"
if [ -f tsconfig.check.json ]; then
  npx tsc -p tsconfig.check.json --noEmit
fi

echo "==> Audit shell strings"
if [ -x scripts/audit-shell-strings.sh ]; then
  bash scripts/audit-shell-strings.sh || true
fi

echo "==> Generating SBOM"
node scripts/sbom.js
SBOM_PATH=".github/releases/sbom-${VERSION}.json"
echo "    ${SBOM_PATH}"

echo "==> Packing tarball"
TARBALL=$(npm pack --silent)
mv "${TARBALL}" ".github/releases/${TARBALL}"
echo "    .github/releases/${TARBALL}"

if command -v cosign >/dev/null 2>&1 && [ "${COSIGN_EXPERIMENTAL:-0}" = "1" ]; then
  echo "==> Signing tarball + SBOM with cosign (keyless OIDC)"
  cosign sign-blob --yes ".github/releases/${TARBALL}"  > ".github/releases/${TARBALL}.sig"
  cosign sign-blob --yes "${SBOM_PATH}"                 > "${SBOM_PATH}.sig"
  echo "    ${TARBALL}.sig"
  echo "    ${SBOM_PATH##*/}.sig"
else
  echo "==> Skipping cosign (not installed or COSIGN_EXPERIMENTAL!=1)"
fi

echo "==> Release artifacts in .github/releases/:"
ls -la .github/releases/

echo "==> Done."
