# Contributing to update-kit

Thank you for your interest in contributing to update-kit. This guide explains how to report issues, suggest improvements, and submit code changes.

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive experience for everyone.

## How to Contribute

### Reporting Bugs

1. Search [existing issues](../../issues) to check if the bug has already been reported
2. If not, open a new issue with:
   - Steps to reproduce the bug
   - Expected behavior vs. actual behavior
   - Your environment (OS, Node.js version)
   - Error messages or logs if applicable

### Suggesting Enhancements

1. Search [existing issues](../../issues) for similar suggestions
2. Open a new issue describing:
   - The problem or use case
   - Your proposed solution
   - Alternatives you considered

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main` (`git checkout -b feature/your-feature`)
3. Make your changes
4. Ensure `pnpm lint` and `pnpm test` pass
5. Write clear commit messages (see Style Guide below)
6. Push to your fork and open a pull request
7. Fill in the PR description explaining what changed and why

## Development Setup

### Requirements

- Node.js 18 or later
- [pnpm](https://pnpm.io/) (this project uses pnpm exclusively)

### Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/update-kit.git
cd update-kit
pnpm install
```

### Common Commands

```bash
pnpm build              # Build with tsup (ESM + CJS dual output)
pnpm test               # Run all tests with vitest
pnpm test:watch         # Run tests in watch mode
pnpm lint               # Type-check with tsc --noEmit
```

### Project Structure

```
src/
├── detection/          # Install channel detection (receipt, brew, npm, heuristics)
├── checker/            # Version checking with caching and background refresh
│   ├── sources/        # Pluggable version sources (GitHub, npm, JSR, Brew, custom)
│   └── infer-sources.ts # Auto-inference of sources from config and package.json
├── planner/            # Update strategy selection
├── applier/            # Update execution (native download, delegate command, verify)
├── platform/           # OS-specific cache paths and atomic file replacement
├── utils/              # HTTP, filesystem, and security helpers
├── ux/                 # Banner rendering, progress display, ANSI colors, hooks
├── index.ts            # UpdateKit class (public API)
├── cli.ts              # CLI entry point
├── config.ts           # Configuration interface
├── types.ts            # Core type definitions
├── errors.ts           # Structured error codes
└── doctor.ts           # Diagnostic checks (config, sources, connectivity)
```

## Style Guide

### Code Style

Follow the existing patterns in the codebase. Key conventions:

- All code and comments must be in English
- Internal imports use `.js` extensions (TypeScript ESM convention)
- Discriminated unions with `kind` or `type` fields for result types
- External I/O (network, filesystem, child_process) must be mocked in tests

### Type Checking

Run the type checker before submitting:

```bash
pnpm lint
```

### Commit Messages

This project uses the `type: description` format:

```
feat: Add npm registry version source
fix: Handle missing checksum in native applier
test: Add integration tests for delegate mode
```

- Use the imperative mood: "Add feature" not "Added feature"
- Keep the first line under 72 characters
- Reference issue numbers when applicable: `Fix #123`

## Testing

Run the test suite before submitting a pull request:

```bash
pnpm test
```

Tests are co-located with source code in `__tests__/` subdirectories. Integration tests are in `src/__tests__/`.

To run tests for a specific module:

```bash
pnpm test -- src/checker
```

To run a single test file:

```bash
pnpm test -- src/checker/__tests__/cache.test.ts
```

Tests use vitest with globals enabled. All external I/O is mocked with `vi.mock()`.
