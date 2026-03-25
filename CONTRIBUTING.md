# Contributing to update-kit

Thank you for your interest in contributing to update-kit. This guide explains how to report issues, suggest improvements, and submit code changes.

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive experience for everyone.

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/syi0808/update-kit/issues) to check if the bug has already been reported
2. If not, open a new issue with:
   - Steps to reproduce the bug
   - Expected behavior vs. actual behavior
   - Your environment (OS, Node.js version)
   - Error messages or logs

### Suggesting Enhancements

1. Search [existing issues](https://github.com/syi0808/update-kit/issues) for similar suggestions
2. Open a new issue describing:
   - The problem or use case
   - Your proposed solution
   - Alternatives you considered

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main` (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run `pnpm check` and `pnpm test` to verify
5. Write clear commit messages (see Style Guide below)
6. Push to your fork and open a pull request
7. Fill in the PR description explaining what changed and why

## Development Setup

**Requirements:** Node.js 24+, [pnpm](https://pnpm.io/)

```bash
git clone https://github.com/YOUR_USERNAME/update-kit.git
cd update-kit
pnpm install
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build with tsup (ESM + CJS dual output) |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test -- src/checker` | Run tests in a specific directory |
| `pnpm check` | Lint and format check (Biome) |
| `pnpm format` | Auto-fix formatting |
| `pnpm typecheck` | Type-check with `tsc --noEmit` |
| `pnpm coverage` | Run tests with coverage |

### Project Structure

```
src/
├── detection/       # Install channel detection
├── checker/         # Version checking, caching, background refresh
│   └── sources/     # Pluggable version sources (GitHub, npm, JSR, Brew, custom)
├── planner/         # Update strategy selection
├── applier/         # Update execution (native, delegate, verify)
├── platform/        # OS-specific paths and atomic file replacement
├── utils/           # HTTP, filesystem, security helpers
├── ux/              # Banner, progress, colors, hooks
├── index.ts         # UpdateKit class (public API)
├── cli.ts           # CLI entry point
├── config.ts        # Configuration types
├── types.ts         # Core type definitions
├── errors.ts        # Structured error codes
└── doctor.ts        # Diagnostic checks
```

## Style Guide

### Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Run checks before submitting:

```bash
pnpm check       # Lint + format check
pnpm format      # Auto-fix formatting
```

Key conventions:

- All code and comments in English
- Internal imports use `.js` extensions (TypeScript ESM convention)
- Discriminated unions with `kind` or `type` fields for result types

### Commit Messages

Use the `type: description` format in imperative mood:

```
feat: Add npm registry version source
fix: Handle missing checksum in native applier
test: Add integration tests for delegate mode
docs: Update API reference for version listing
chore: Bump vitest to v4
```

Keep the first line under 72 characters. Reference issues when applicable (`Fix #123`).

## Testing

Tests live in `__tests__/` subdirectories next to their source modules. Integration tests are in `src/__tests__/`.

```bash
pnpm test                                        # All tests
pnpm test -- src/checker                         # Module tests
pnpm test -- src/checker/__tests__/cache.test.ts # Single file
pnpm coverage                                    # With coverage report
```

All external I/O (network, filesystem, child_process) is mocked with `vi.mock()`. Please maintain this pattern in new tests.
