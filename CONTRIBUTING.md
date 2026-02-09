# Contributing to update-kit

Thanks for considering a contribution. This guide covers how to report issues, suggest changes, and submit pull requests.

## Reporting Bugs

1. Search [existing issues](../../issues) first
2. If none match, open a new issue with:
   - Steps to reproduce
   - Expected vs. actual behavior
   - Environment (OS, Node.js version)
   - Error messages or logs

## Suggesting Changes

Open an issue describing:
- The problem or use case
- Your proposed solution
- Alternatives you considered

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm typecheck` and `pnpm test`
4. Push and open a pull request with a clear description of what changed and why

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
| `pnpm build` | Build with tsup (ESM + CJS) |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | Type-check with `tsc --noEmit` |

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

## Code Style

- All code and comments in English
- Internal imports use `.js` extensions (TypeScript ESM convention)
- Discriminated unions with `kind` or `type` fields for result types
- External I/O (network, filesystem, child_process) must be mocked in tests

## Commit Messages

Use the `type: description` format in imperative mood:

```
feat: Add npm registry version source
fix: Handle missing checksum in native applier
test: Add integration tests for delegate mode
```

Keep the first line under 72 characters. Reference issues when applicable (`Fix #123`).

## Testing

Tests live in `__tests__/` subdirectories next to their source modules. Integration tests are in `src/__tests__/`.

```bash
pnpm test                                        # All tests
pnpm test -- src/checker                         # Module tests
pnpm test -- src/checker/__tests__/cache.test.ts # Single file
```

All external I/O is mocked with `vi.mock()`. Please maintain this pattern in new tests.
