#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

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

const REPO_URL = 'https://github.com/forkline/cli';

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
      execSync(`tar -xzf "${assetPath}" -C "${tmpDir}"`, { stdio: 'pipe' });
      const archiveDir = fs.readdirSync(tmpDir)[0];
      const srcBin = path.join(tmpDir, archiveDir, binName);
      if (!fs.existsSync(srcBin)) {
        throw new Error(`Binary ${binName} not found in archive at ${assetPath}`);
      }
      fs.copyFileSync(srcBin, outBinPath);
    } else if (assetType === 'zip') {
      const result = spawnSync('unzip', ['-o', assetPath, '-d', tmpDir], { stdio: 'pipe' });
      if (result.status !== 0) {
        const bsdtar = spawnSync('bsdtar', ['-xf', assetPath, '-C', tmpDir], { stdio: 'pipe' });
        if (bsdtar.status !== 0) {
          throw new Error('Neither unzip nor bsdtar available for zip extraction');
        }
      }
      const archiveDir = fs.readdirSync(tmpDir)[0];
      const srcBin = path.join(tmpDir, archiveDir, binName);
      if (!fs.existsSync(srcBin)) {
        throw new Error(`Binary ${binName} not found in archive at ${assetPath}`);
      }
      fs.copyFileSync(srcBin, outBinPath);
    } else {
      fs.copyFileSync(assetPath, outBinPath);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

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

  if (!fs.existsSync(assetsDir)) {
    console.error(`Assets directory not found: ${assetsDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let found = 0;
  let missing = [];

  for (const [rustTarget, targetInfo] of Object.entries(TARGETS)) {
    const asset = findAsset(assetsDir, version, rustTarget);
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
