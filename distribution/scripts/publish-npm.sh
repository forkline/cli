#!/usr/bin/env bash
set -euo pipefail

TAG="${1:?Usage: publish-npm.sh <tag> <packages-dir>}"
PACKAGES_DIR="${2:?Usage: publish-npm.sh <tag> <packages-dir>}"

VERSION="${TAG#v}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "ERROR: invalid version format: $VERSION (from tag $TAG)" >&2
  exit 1
fi

if [[ ! -d "$PACKAGES_DIR" ]]; then
  echo "ERROR: packages directory not found: $PACKAGES_DIR" >&2
  exit 1
fi

if [[ "$VERSION" =~ - ]]; then
  DIST_TAG="next"
else
  DIST_TAG="latest"
fi

DRY_RUN="${PUBLISH_DRY_RUN:-false}"

PLATFORM_PKGS=(
  cli-darwin-arm64
  cli-darwin-x64
  cli-linux-arm64-gnu
  cli-linux-arm64-musl
  cli-linux-x64-gnu
  cli-linux-x64-musl
  cli-win32-arm64
  cli-win32-x64
)

ALL_PKGS=("${PLATFORM_PKGS[@]}" cli)

echo "=== Preflight: verifying all 9 packages absent at version $VERSION ==="
PREFLIGHT_FAILED=false
for pkg in "${ALL_PKGS[@]}"; do
  if npm view "@forkline/$pkg@$VERSION" version >/dev/null 2>&1; then
    echo "  EXISTS: @forkline/$pkg@$VERSION" >&2
    PREFLIGHT_FAILED=true
  else
    echo "  absent: @forkline/$pkg@$VERSION (ok)"
  fi
done

if [[ "$PREFLIGHT_FAILED" == "true" ]]; then
  echo "ERROR: one or more packages already published at version $VERSION — aborting" >&2
  exit 1
fi
echo "Preflight passed: all 9 packages absent at $VERSION"

for pkg in "${PLATFORM_PKGS[@]}"; do
  pkg_dir="$PACKAGES_DIR/$pkg"
  if [[ ! -d "$pkg_dir" ]]; then
    echo "ERROR: platform package directory missing: $pkg_dir" >&2
    exit 1
  fi
done

if [[ ! -d "$PACKAGES_DIR/cli" ]]; then
  echo "ERROR: wrapper package directory missing: $PACKAGES_DIR/cli" >&2
  exit 1
fi

publish_pkg() {
  local pkg_dir="$1"
  local pkg_name="$2"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY RUN] packing $pkg_name from $pkg_dir"
    (cd "$pkg_dir" && npm pack)
  else
    echo "PUBLISH: $pkg_name (tag=$DIST_TAG)"
    npm publish "$pkg_dir" --access public --tag "$DIST_TAG"
  fi
}

echo ""
echo "=== Publishing 8 platform packages (dist-tag: $DIST_TAG) ==="
for pkg in "${PLATFORM_PKGS[@]}"; do
  publish_pkg "$PACKAGES_DIR/$pkg" "@forkline/$pkg"
done

echo ""
echo "=== Publishing wrapper package (dist-tag: $DIST_TAG) ==="
publish_pkg "$PACKAGES_DIR/cli" "@forkline/cli"

echo ""
echo "=== Complete: 9 packages published at $VERSION (tag: $DIST_TAG) ==="
