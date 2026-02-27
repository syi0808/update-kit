# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Eliminated all `as any` type casts: typed GitHub API responses, DOM/Node stream conversion, Dirent compatibility, hook return type, config assertions
- CLI config loading now validates JSON structure and required fields (`appName`, `currentVersion`) with user-friendly error messages
- Windows atomic replace now handles rollback failure gracefully with an actionable error message including backup file path
- GitHub release asset URLs are now validated as HTTPS before use (non-HTTPS and malformed URLs are filtered out)
- Archive binary search now includes symlink escape protection via `realpath` containment checks
- Asset pattern expansion now validates pattern length (max 256 chars) and wraps `RegExp` construction in try-catch
- Background version checks are deduplicated within the same process to prevent cache write races
- Delegate command stdout/stderr buffers are now capped at 10 MB to prevent OOM on pathological output
- `prepublishOnly` script now uses `pnpm build` instead of `npm run build`

### Changed
- Magic numbers (timeouts, intervals, buffer limits) extracted to `src/constants.ts` as named exports
- Constants are re-exported from the public API for consumer customization reference

### Added
- `src/constants.ts` module with all timeout/interval/limit constants
- Test coverage for: checker not-modified without cache, rate-limit path verification, GitHub HTTPS asset filtering, Windows rollback recovery, background check deduplication, asset pattern validation
