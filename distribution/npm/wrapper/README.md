# @forkline/cli

Forkline CLI - OpenCode runner management platform.

## Installation

```bash
npm install -g @forkline/cli
```

Or use without installing:

```bash
npx @forkline/cli --help
```

## Usage

```bash
forkline --help
forkline --version
forkline completions bash
```

## Supported Platforms

Pre-built binaries are available for:

| Platform | Architecture | libc |
|----------|--------------|------|
| macOS | arm64 (Apple Silicon) | — |
| macOS | x64 (Intel) | — |
| Linux | arm64 | glibc |
| Linux | arm64 | musl (Alpine) |
| Linux | x64 | glibc (Debian/Ubuntu) |
| Linux | x64 | musl (Alpine) |
| Windows | arm64 | — |
| Windows | x64 | — |

The correct platform-specific package is installed automatically as an optional dependency.

## Environment Variables

### `FORKLINE_BINARY`

Override the binary path. Useful for testing or using a custom build:

```bash
export FORKLINE_BINARY=/path/to/custom/forkline
forkline --version
```

## Manual Binary Installation

If npm installation fails or you need a specific platform binary:

1. Download the appropriate archive from [GitHub Releases](https://github.com/forkline/cli/releases)
2. Extract the `forkline` binary
3. Set `FORKLINE_BINARY` to point to it

## Troubleshooting

### "Platform package not installed"

This usually means npm was run with `--no-optional`. Reinstall without that flag:

```bash
npm install @forkline/cli
```

Or download the binary manually and use `FORKLINE_BINARY`.

### "Permission denied"

The binary needs execute permissions:

```bash
chmod +x node_modules/@forkline/cli-linux-x64-gnu/bin/forkline
```

(Adjust platform package name as needed)

## Links

- [GitHub Repository](https://github.com/forkline/cli)
- [Releases](https://github.com/forkline/cli/releases)
- [Issue Tracker](https://github.com/forkline/cli/issues)
