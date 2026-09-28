#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const PLATFORMS = {
  'darwin-arm64': { os: 'darwin', arch: 'arm64', pkg: '@forkline/cli-darwin-arm64', bin: 'forkline' },
  'darwin-x64': { os: 'darwin', arch: 'x64', pkg: '@forkline/cli-darwin-x64', bin: 'forkline' },
  'linux-arm64-gnu': { os: 'linux', arch: 'arm64', libc: 'glibc', pkg: '@forkline/cli-linux-arm64-gnu', bin: 'forkline' },
  'linux-arm64-musl': { os: 'linux', arch: 'arm64', libc: 'musl', pkg: '@forkline/cli-linux-arm64-musl', bin: 'forkline' },
  'linux-x64-gnu': { os: 'linux', arch: 'x64', libc: 'glibc', pkg: '@forkline/cli-linux-x64-gnu', bin: 'forkline' },
  'linux-x64-musl': { os: 'linux', arch: 'x64', libc: 'musl', pkg: '@forkline/cli-linux-x64-musl', bin: 'forkline' },
  'win32-arm64': { os: 'win32', arch: 'arm64', pkg: '@forkline/cli-win32-arm64', bin: 'forkline.exe' },
  'win32-x64': { os: 'win32', arch: 'x64', pkg: '@forkline/cli-win32-x64', bin: 'forkline.exe' },
};

function detectLinuxLibc() {
  try {
    const report = process.report.getReport();
    if (report && report.header && report.header.glibcVersionRuntime) {
      return 'glibc';
    }
  } catch (e) {
    // process.report not available, fall through
  }

  try {
    const result = require('child_process').spawnSync('ldd', ['--version'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const output = (result.stdout || '') + (result.stderr || '');
    if (output.toLowerCase().includes('musl')) {
      return 'musl';
    }
  } catch (e) {
    // ldd not available or failed
  }

  return 'glibc';
}

function resolvePlatform() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') {
    const libc = detectLinuxLibc();
    const libcSuffix = libc === 'glibc' ? 'gnu' : 'musl';
    return `${platform}-${arch}-${libcSuffix}`;
  }

  return `${platform}-${arch}`;
}

function main() {
  const platformKey = resolvePlatform();
  const platformInfo = PLATFORMS[platformKey];

  if (!platformInfo) {
    console.error(`Error: Unsupported platform ${process.platform}/${process.arch}`);
    console.error('Supported platforms:');
    Object.keys(PLATFORMS).forEach(key => {
      const info = PLATFORMS[key];
      console.error(`  - ${info.os}/${info.arch}${info.libc ? ` (${info.libc})` : ''}`);
    });
    process.exit(1);
  }

  const binaryPath = process.env.FORKLINE_BINARY;
  let resolvedPath;

  if (binaryPath) {
    resolvedPath = binaryPath;
  } else {
    try {
      resolvedPath = require.resolve(`${platformInfo.pkg}/bin/${platformInfo.bin}`);
    } catch (e) {
      console.error(`Error: Platform package ${platformInfo.pkg} not installed.`);
      console.error('Reinstall without --no-optional or set FORKLINE_BINARY environment variable.');
      process.exit(1);
    }
  }

  const args = process.argv.slice(2);
  const result = spawnSync(resolvedPath, args, {
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    if (result.error.code === 'EACCES') {
      console.error(`Error: Permission denied executing ${resolvedPath}`);
      console.error('Try: chmod +x ' + resolvedPath);
    } else if (result.error.code === 'ENOENT') {
      console.error(`Error: Binary not found at ${resolvedPath}`);
      console.error('Platform package may be corrupted. Try reinstalling.');
    } else {
      console.error(`Error: ${result.error.message}`);
    }
    process.exit(1);
  }

  process.exit(result.status || 0);
}

main();
