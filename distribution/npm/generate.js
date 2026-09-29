#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TARGETS = {
  'aarch64-apple-darwin': { npm: 'darwin-arm64', os: ['darwin'], cpu: ['arm64'] },
  'x86_64-apple-darwin': { npm: 'darwin-x64', os: ['darwin'], cpu: ['x64'] },
  'aarch64-unknown-linux-gnu': { npm: 'linux-arm64-gnu', os: ['linux'], cpu: ['arm64'], libc: ['glibc'] },
  'x86_64-unknown-linux-gnu': { npm: 'linux-x64-gnu', os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
  'aarch64-unknown-linux-musl': { npm: 'linux-arm64-musl', os: ['linux'], cpu: ['arm64'], libc: ['musl'] },
  'x86_64-unknown-linux-musl': { npm: 'linux-x64-musl', os: ['linux'], cpu: ['x64'], libc: ['musl'] },
  'aarch64-pc-windows-msvc': { npm: 'win32-arm64', os: ['win32'], cpu: ['arm64'] },
  'x86_64-pc-windows-msvc': { npm: 'win32-x64', os: ['win32'], cpu: ['x64'] },
};

const REPO_URL = 'git+https://github.com/forkline/cli.git';
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9][a-zA-Z0-9.]*)?$/;

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { requireAll: false, outDir: null, assetsDir: null, version: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--assets-dir') parsed.assetsDir = args[++i];
    else if (args[i] === '--version') parsed.version = args[++i];
    else if (args[i] === '--out-dir') parsed.outDir = args[++i];
    else if (args[i] === '--require-all') parsed.requireAll = true;
  }

  if (!parsed.assetsDir || !parsed.version) {
    console.error('Usage: generate.js --assets-dir <dir> --version <version> [--out-dir <dir>] [--require-all]');
    process.exit(1);
  }

  if (!SEMVER_RE.test(parsed.version)) {
    console.error(`ERROR: invalid version format: ${parsed.version}`);
    process.exit(1);
  }

  if (!path.isAbsolute(parsed.assetsDir) && !parsed.assetsDir.startsWith('.')) {
    console.error(`ERROR: assets-dir must be an absolute or relative path: ${parsed.assetsDir}`);
    process.exit(1);
  }

  if (!parsed.outDir) {
    parsed.outDir = path.join(__dirname, 'packages');
  }

  return parsed;
}

function findAsset(assetsDir, version, target) {
  const base = `forkline-${version}-${target}`;
  const candidates = [
    path.join(assetsDir, `${base}.tar.gz`),
    path.join(assetsDir, `${base}.zip`),
    path.join(assetsDir, base),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return { path: c, type: c.endsWith('.tar.gz') ? 'tar.gz' : c.endsWith('.zip') ? 'zip' : 'bare' };
  }
  return null;
}

function assertWithin(childPath, parentDir) {
  const resolvedChild = path.resolve(childPath);
  const resolvedParent = path.resolve(parentDir);
  if (!resolvedChild.startsWith(resolvedParent + path.sep) && resolvedChild !== resolvedParent) {
    throw new Error(`Path traversal detected: ${childPath} escapes ${parentDir}`);
  }
}

function findBinDir(tmpDir, binName) {
  const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(tmpDir, entry.name, binName);
    if (fs.existsSync(candidate)) {
      assertWithin(candidate, tmpDir);
      return path.join(tmpDir, entry.name);
    }
  }
  return null;
}

function extractBinary(assetPath, assetType, target, outBinPath) {
  const isWindows = target.includes('windows');
  const binName = isWindows ? 'forkline.exe' : 'forkline';
  const tmpDir = path.join(path.dirname(outBinPath), '.extract-tmp');

  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    if (assetType === 'tar.gz') {
      const result = spawnSync('tar', ['-xzf', assetPath, '-C', tmpDir], { stdio: 'pipe' });
      if (result.error) {
        if (result.error.code === 'ENOENT') {
          throw new Error('tar command not found — install tar and retry');
        }
        throw new Error(`tar failed: ${result.error.message}`);
      }
      if (result.status !== 0) {
        const stderr = (result.stderr || '').toString().trim();
        throw new Error(`tar exited ${result.status} extracting ${path.basename(assetPath)}: ${stderr || 'archive may be corrupt'}`);
      }
      const archiveDir = findBinDir(tmpDir, binName);
      if (!archiveDir) {
        throw new Error(`Binary ${binName} not found in archive at ${path.basename(assetPath)}`);
      }
      const srcBin = path.join(archiveDir, binName);
      assertWithin(srcBin, tmpDir);
      fs.copyFileSync(srcBin, outBinPath);
    } else if (assetType === 'zip') {
      const result = spawnSync('unzip', ['-o', assetPath, '-d', tmpDir], { stdio: 'pipe' });
      if (result.error && result.error.code === 'ENOENT') {
        const bsdtar = spawnSync('bsdtar', ['-xf', assetPath, '-C', tmpDir], { stdio: 'pipe' });
        if (bsdtar.error && bsdtar.error.code === 'ENOENT') {
          throw new Error('Neither unzip nor bsdtar found — install one and retry');
        }
        if (bsdtar.status !== 0) {
          const stderr = (bsdtar.stderr || '').toString().trim();
          throw new Error(`bsdtar exited ${bsdtar.status} extracting ${path.basename(assetPath)}: ${stderr || 'archive may be corrupt'}`);
        }
      } else if (result.status !== 0) {
        const bsdtar = spawnSync('bsdtar', ['-xf', assetPath, '-C', tmpDir], { stdio: 'pipe' });
        if (bsdtar.error && bsdtar.error.code === 'ENOENT') {
          const stderr = (result.stderr || '').toString().trim();
          throw new Error(`unzip exited ${result.status} and bsdtar not found: ${stderr || 'archive may be corrupt'}`);
        }
        if (bsdtar.status !== 0) {
          const stderr = (bsdtar.stderr || '').toString().trim();
          throw new Error(`Both unzip and bsdtar failed extracting ${path.basename(assetPath)}: ${stderr || 'archive may be corrupt'}`);
        }
      }
      const archiveDir = findBinDir(tmpDir, binName);
      if (!archiveDir) {
        throw new Error(`Binary ${binName} not found in archive at ${path.basename(assetPath)}`);
      }
      const srcBin = path.join(archiveDir, binName);
      assertWithin(srcBin, tmpDir);
      fs.copyFileSync(srcBin, outBinPath);
    } else {
      fs.copyFileSync(assetPath, outBinPath);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const resolvedOut = path.resolve(outBinPath);
  assertWithin(resolvedOut, path.resolve(path.dirname(outBinPath)));
  fs.chmodSync(outBinPath, 0o755);
}

function writePlatformPackage(outDir, npmPlatform, targetInfo, version) {
  const pkgDir = path.join(outDir, `cli-${npmPlatform}`);
  const binDir = path.join(pkgDir, 'bin');

  if (fs.existsSync(pkgDir)) {
    fs.rmSync(pkgDir, { recursive: true, force: true });
  }
  fs.mkdirSync(binDir, { recursive: true });

  const isWindows = npmPlatform.startsWith('win32');
  const binName = isWindows ? 'forkline.exe' : 'forkline';

  const pkgJson = {
    name: `@forkline/cli-${npmPlatform}`,
    version,
    description: `Forkline CLI binary for ${npmPlatform}`,
    os: targetInfo.os,
    cpu: targetInfo.cpu,
    files: ['bin'],
    license: 'MIT',
    repository: { type: 'git', url: REPO_URL },
  };

  if (targetInfo.libc) {
    pkgJson.libc = targetInfo.libc;
  }

  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');
  return { pkgDir, binDir, binName };
}

function writeWrapperPackage(outDir, version, wrapperTemplateDir) {
  const pkgDir = path.join(outDir, 'cli');

  if (fs.existsSync(pkgDir)) {
    fs.rmSync(pkgDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });

  const templatePkg = JSON.parse(fs.readFileSync(path.join(wrapperTemplateDir, 'package.json'), 'utf8'));
  templatePkg.version = version;
  templatePkg.repository = { type: 'git', url: REPO_URL };
  for (const key of Object.keys(templatePkg.optionalDependencies)) {
    templatePkg.optionalDependencies[key] = version;
  }
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(templatePkg, null, 2) + '\n');

  const resolverSrc = path.join(wrapperTemplateDir, 'bin', 'forkline.js');
  const resolverDst = path.join(pkgDir, 'bin', 'forkline.js');
  fs.copyFileSync(resolverSrc, resolverDst);
  fs.chmodSync(resolverDst, 0o755);

  const readmeSrc = path.join(wrapperTemplateDir, 'README.md');
  if (fs.existsSync(readmeSrc)) {
    fs.copyFileSync(readmeSrc, path.join(pkgDir, 'README.md'));
  }
}

function main() {
  const { assetsDir, version, outDir, requireAll } = parseArgs();
  const wrapperTemplateDir = path.join(__dirname, 'wrapper');

  const resolvedAssets = path.resolve(assetsDir);
  if (!fs.existsSync(resolvedAssets) || !fs.statSync(resolvedAssets).isDirectory()) {
    console.error(`Assets directory not found: ${assetsDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let found = 0;
  let missing = [];

  for (const [rustTarget, targetInfo] of Object.entries(TARGETS)) {
    const asset = findAsset(resolvedAssets, version, rustTarget);
    if (!asset) {
      missing.push(rustTarget);
      continue;
    }

    console.log(`Processing ${rustTarget} -> ${targetInfo.npm} (${asset.type})`);
    const { pkgDir, binDir, binName } = writePlatformPackage(outDir, targetInfo.npm, targetInfo, version);
    const outBinPath = path.join(binDir, binName);
    extractBinary(asset.path, asset.type, rustTarget, outBinPath);
    found++;
  }

  if (missing.length > 0) {
    if (requireAll) {
      console.error(`Missing assets for targets: ${missing.join(', ')}`);
      process.exit(1);
    } else {
      console.warn(`Warning: Missing assets for targets: ${missing.join(', ')}`);
    }
  }

  console.log(`Generating wrapper package...`);
  writeWrapperPackage(outDir, version, wrapperTemplateDir);

  console.log(`Done. Generated ${found} platform package(s) + wrapper in ${outDir}`);
}

main();
