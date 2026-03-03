# Design: Update integrating-update-kit Skill

Date: 2026-03-03

## Problem

The `integrating-update-kit` skill files are out of date relative to the current codebase. Several features added since the skill was last updated are not documented.

## Approach

Incremental patch — add new features in-place to each existing file, keeping structure and tone.

## Changes

### SKILL.md

- Add `listVersions()` and `switchVersion()` to quick reference methods table
- Add `customDetectors`, `customPlanResolver`, `repository` to config mentions
- Add version listing/switching option to Step 2 (Ask the user)
- Update Node.js requirement to `>=24.0.0`

### api-reference.md

- Update Node.js requirement to `>=24.0.0`
- Add `customDetectors`, `customPlanResolver`, `repository` to Configuration Options
- Add `listVersions()` and `switchVersion()` method docs
- Add `up-to-date` variant to ApplyResult
- Add `executing` phase to ApplyProgress
- Add `assets?` field to UpdateStatus `available` variant
- Note custom string channels via `(string & {})`
- Add types: `CustomDetector`, `PlanResolverContext`, `MessageTemplates`, `FetchVersionsOptions`, `VersionListResult`, `VersionInfo`, `AssetInfo`

### integration-patterns.md

- Add Pattern E: Version Listing & Switching
- Add Pattern F: Custom Detectors & Plan Resolvers
- Add Pattern G: Custom Message Templates
- Update Combining Patterns section
