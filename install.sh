#!/bin/sh
set -eu

REPO="forkline/cli"
API_URL="${FORKLINE_GITHUB_API_URL:-https://api.github.com}"
DOWNLOAD_BASE="${FORKLINE_DOWNLOAD_BASE_URL:-https://github.com/${REPO}/releases/download}"

say() { printf '%s\n' "$*" >&2; }
fail() { say "error: $*"; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed"; }

detect_os() {
  _uname_s="$(uname -s)"
  case "$_uname_s" in
    Linux)  echo "linux" ;;
    Darwin) echo "darwin" ;;
    MINGW*|MSYS*|CYGWIN*) fail "Windows is not supported by this installer. Use npm (npm install -g @forkline/cli) or download the ZIP from https://github.com/${REPO}/releases" ;;
    *)      fail "unsupported OS: $_uname_s" ;;
  esac
}

detect_arch() {
  _uname_m="$(uname -m)"
  case "$_uname_m" in
    x86_64|amd64)   echo "x86_64" ;;
    aarch64|arm64)  echo "aarch64" ;;
    *)              fail "unsupported architecture: $_uname_m" ;;
  esac
}

detect_libc() {
  if ldd --version 2>&1 | grep -qi musl; then
    echo "musl"
  elif ls /lib/ld-musl-* >/dev/null 2>&1; then
    echo "musl"
  else
    echo "gnu"
  fi
}

map_target() {
  _os="$1"
  _arch="$2"
  case "$_os" in
    linux)
      _libc="$(detect_libc)"
      echo "${_arch}-unknown-linux-${_libc}"
      ;;
    darwin)
      echo "${_arch}-apple-darwin"
      ;;
  esac
}

resolve_version() {
  if [ -n "${FORKLINE_VERSION:-}" ]; then
    _v="$FORKLINE_VERSION"
    _v="${_v#v}"
    echo "$_v"
    return
  fi
  _url="${API_URL}/repos/${REPO}/releases/latest"
  _json="$(curl -sS -H "Accept: application/vnd.github+json" "$_url")" || fail "failed to fetch latest release from $_url"
  _tag="$(echo "$_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  [ -n "$_tag" ] || fail "could not parse tag_name from GitHub API response"
  _tag="${_tag#v}"
  echo "$_tag"
}

resolve_install_dir() {
  if [ -n "${FORKLINE_INSTALL_DIR:-}" ]; then
    echo "$FORKLINE_INSTALL_DIR"
    return
  fi
  if [ -w /usr/local/bin ]; then
    echo "/usr/local/bin"
  else
    echo "${HOME}/.local/bin"
  fi
}

find_checksum() {
  _file="$1"
  _sums="$2"
  _line="$(grep "  ${_file}$" "$_sums" || true)"
  [ -n "$_line" ] || fail "checksum for ${_file} not found in SHA256SUMS.txt"
  echo "$_line" | awk '{print $1}'
}

verify_checksum() {
  _file="$1"
  _expected="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    _actual="$(sha256sum "$_file" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    _actual="$(shasum -a 256 "$_file" | awk '{print $1}')"
  else
    fail "neither sha256sum nor shasum found; cannot verify checksum"
  fi
  if [ "$_actual" != "$_expected" ]; then
    fail "checksum mismatch for $(basename "$_file"): expected $_expected, got $_actual"
  fi
}

main() {
  need curl

  os="$(detect_os)"
  arch="$(detect_arch)"
  target="$(map_target "$os" "$arch")"
  version="$(resolve_version)"
  install_dir="$(resolve_install_dir)"

  archive="forkline-${version}-${target}.tar.gz"
  tag="v${version}"
  base_url="${DOWNLOAD_BASE}/${tag}"

  say "detected: ${os} ${arch} (${target})"
  say "version: ${version}"
  say "install dir: ${install_dir}"

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  say "downloading ${archive}..."
  curl -sSfL -o "${tmpdir}/${archive}" "${base_url}/${archive}" || fail "failed to download ${archive}"

  say "downloading SHA256SUMS.txt..."
  curl -sSfL -o "${tmpdir}/SHA256SUMS.txt" "${base_url}/SHA256SUMS.txt" || fail "failed to download SHA256SUMS.txt"

  expected_checksum="$(find_checksum "$archive" "${tmpdir}/SHA256SUMS.txt")"
  say "verifying checksum..."
  verify_checksum "${tmpdir}/${archive}" "$expected_checksum"

  say "extracting..."
  tar -xzf "${tmpdir}/${archive}" -C "$tmpdir" || fail "failed to extract archive"

  binary=""
  if [ -f "${tmpdir}/${target}/forkline" ]; then
    binary="${tmpdir}/${target}/forkline"
  else
    binary="$(find "$tmpdir" -name forkline -type f | head -1)"
  fi
  [ -n "$binary" ] || fail "forkline binary not found in archive"

  mkdir -p "$install_dir"
  cp "$binary" "${tmpdir}/forkline"
  chmod 0755 "${tmpdir}/forkline"
  mv "${tmpdir}/forkline" "${install_dir}/forkline"

  if [ -x "${install_dir}/forkline" ]; then
    if "${install_dir}/forkline" --version >/dev/null 2>&1; then
      say "$("${install_dir}/forkline" --version)"
    fi
  fi

  case ":${PATH}:" in
    *":${install_dir}:"*) ;;
    *) say "hint: ${install_dir} is not in your PATH. Add it with:"
       say "  export PATH=\"${install_dir}:\$PATH\""
       ;;
  esac

  say "forkline ${version} installed to ${install_dir}/forkline"
}

main "$@"
