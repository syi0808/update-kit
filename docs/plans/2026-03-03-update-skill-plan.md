# Implementation Plan: Update integrating-update-kit Skill

Design: `docs/plans/2026-03-03-update-skill-design.md`

## Steps

### Step 1: Update SKILL.md

File: `.claude/skills/integrating-update-kit/SKILL.md`

1. In Quick reference, Main methods table, add rows for `listVersions()` and `switchVersion()`
2. In Quick reference, Creating an instance (or nearby), add mention of `customDetectors`, `customPlanResolver`, `repository` config fields
3. In Step 2 (Ask the user), add version listing/switching as an update behavior option
4. Update any Node.js version references to `>=24.0.0`

### Step 2: Update api-reference.md

File: `.claude/skills/integrating-update-kit/references/api-reference.md`

1. Update Node.js requirement from `>=18` to `>=24.0.0`
2. Add `customDetectors`, `customPlanResolver`, `repository` to Configuration Options block
3. Add `listVersions()` method documentation after `applyUpdate()`
4. Add `switchVersion()` method documentation after `listVersions()`
5. Add `up-to-date` variant to ApplyResult union
6. Add `executing` phase to ApplyProgress
7. Add `assets?` field to UpdateStatus `available` variant
8. Note custom string channels on Channel type
9. Add new types section: `CustomDetector`, `PlanResolverContext`, `FetchVersionsOptions`, `VersionListResult`, `VersionInfo`, `AssetInfo`, `MessageTemplates`
10. Add `PLAN_REJECTED` and `SIGNATURE_INVALID` error codes if missing

### Step 3: Update integration-patterns.md

File: `.claude/skills/integrating-update-kit/references/integration-patterns.md`

1. Add ToC entries for new patterns
2. Add Pattern E: Version Listing & Switching
3. Add Pattern F: Custom Detectors & Plan Resolvers
4. Add Pattern G: Custom Message Templates
5. Update Combining Patterns section

### Step 4: Verify

- Read all three updated files to verify consistency
- Confirm all new methods, types, and config options from `src/index.ts` are covered
