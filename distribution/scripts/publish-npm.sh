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

check_pkg_exists() {
  local pkg_name="$1"
  local remote_version
  remote_version="$(npm view "@forkline/${pkg_name}@${VERSION}" version 2>/dev/null || true)"
  if [[ "$remote_version" == "$VERSION" ]]; then
    return 0
  fi
  return 1
}

validate_pkg_metadata() {
  local pkg_dir="$1"
  local pkg_name="$2"
  local local_version local_name

  local_version="$(node -p "require(process.argv[1]).version" "$(realpath "$pkg_dir/package.json")")"
  local_name="$(node -p "require(process.argv[1]).name" "$(realpath "$pkg_dir/package.json")")"

  if [[ "$local_version" != "$VERSION" ]]; then
    echo "ERROR: package ${pkg_name} has version ${local_version}, expected ${VERSION}" >&2
    exit 1
  fi
  if [[ "$local_name" != "@forkline/${pkg_name}" ]]; then
    echo "ERROR: package name mismatch — expected @forkline/${pkg_name}, got ${local_name}" >&2
    exit 1
  fi
}

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

echo "=== Checking existing packages at version $VERSION ==="
SKIP_PLATFORM=()
PUBLISH_PLATFORM=()

for pkg in "${PLATFORM_PKGS[@]}"; do
  pkg_dir="$PACKAGES_DIR/$pkg"
  if [[ ! -d "$pkg_dir" ]]; then
    echo "ERROR: platform package directory missing: $pkg_dir" >&2
    exit 1
  fi
  validate_pkg_metadata "$pkg_dir" "$pkg"

  if check_pkg_exists "$pkg"; then
    echo "  EXISTS (skip): @forkline/$pkg@$VERSION"
    SKIP_PLATFORM+=("$pkg")
  else
    echo "  missing:       @forkline/$pkg@$VERSION (will publish)"
    PUBLISH_PLATFORM+=("$pkg")
  fi
done

if [[ ! -d "$PACKAGES_DIR/cli" ]]; then
  echo "ERROR: wrapper package directory missing: $PACKAGES_DIR/cli" >&2
  exit 1
fi
validate_pkg_metadata "$PACKAGES_DIR/cli" "cli"

echo ""
echo "Summary: ${#SKIP_PLATFORM[@]} existing, ${#PUBLISH_PLATFORM[@]} to publish"

if [[ "${#PUBLISH_PLATFORM[@]}" -gt 0 ]]; then
  echo ""
  echo "=== Publishing ${#PUBLISH_PLATFORM[@]} platform package(s) (dist-tag: $DIST_TAG) ==="
  for pkg in "${PUBLISH_PLATFORM[@]}"; do
    publish_pkg "$PACKAGES_DIR/$pkg" "@forkline/$pkg"
  done
else
  echo ""
  echo "=== All 8 platform packages already published at $VERSION ==="
fi

echo ""
echo "=== Pre-wrapper check: verifying all 8 platform packages on registry ==="
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY RUN] Skipping registry verification (would check all 8 platform packages)"
else
  WRAPPER_BLOCKED=false
  for pkg in "${PLATFORM_PKGS[@]}"; do
    if ! check_pkg_exists "$pkg"; then
      echo "  MISSING: @forkline/$pkg@$VERSION" >&2
      WRAPPER_BLOCKED=true
    fi
  done

  if [[ "$WRAPPER_BLOCKED" == "true" ]]; then
    echo "ERROR: not all 8 platform packages exist at $VERSION — cannot publish wrapper" >&2
    exit 1
  fi
  echo "All 8 platform packages verified on registry"
fi

if check_pkg_exists "cli"; then
  echo ""
  echo "SKIP: @forkline/cli@$VERSION already published"
else
  echo ""
  echo "=== Publishing wrapper package (dist-tag: $DIST_TAG) ==="
  publish_pkg "$PACKAGES_DIR/cli" "@forkline/cli"
fi

echo ""
echo "=== Complete: all 9 packages at $VERSION (tag: $DIST_TAG) ==="
