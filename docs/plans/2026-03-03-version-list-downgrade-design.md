# Version List & Downgrade Design

## Summary

Add two capabilities to update-kit's library API:

1. **Version listing** — Fetch available versions with pagination from pluggable sources.
2. **Downgrade/switch** — Install a specific target version (including older versions) through the existing pipeline.

No CLI commands are added. These features are exposed as library API for CLI apps that integrate update-kit.

---

## 1. VersionSource Interface Extension

Add an **optional** `fetchVersions` method to the existing `VersionSource` interface:

```typescript
interface VersionSource {
  name: string;
  fetchLatest(options?: { etag?: string; signal?: AbortSignal }): Promise<VersionSourceResult>;

  // NEW: optional
  fetchVersions?(options?: FetchVersionsOptions): Promise<VersionListResult>;
}

interface FetchVersionsOptions {
  limit?: number;        // default: 20
  cursor?: string;       // opaque pagination token
  signal?: AbortSignal;
}

type VersionListResult =
  | { kind: 'success'; versions: VersionInfo[]; nextCursor?: string; totalCount?: number }
  | { kind: 'error'; reason: string };
```

### Design decisions

- **Optional method** — Sources that cannot list versions (e.g., Brew) simply omit it.
- **Cursor-based pagination** — Each source encodes its own pagination state into an opaque string (e.g., `"page:2"` for GitHub, `"offset:20"` for npm).
- **Reuses `VersionInfo`** — Same type as `fetchLatest` result: `version`, `releaseUrl`, `releaseNotes`, `assets`, `publishedAt`.
- **Descending order** — Versions are returned newest-first.

---

## 2. Source-Specific Implementations

### GitHub (`GitHubReleasesSource`)

- API: `GET /repos/{owner}/{repo}/releases?per_page={limit}&page={page}`
- Cursor: page number encoded as `"page:N"`
- Naturally paginated by GitHub's API

### npm (`NpmRegistrySource`)

- API: `GET /{packageName}` returns the full packument with a `versions` object
- Client-side: sort by semver descending, then slice for pagination
- Cursor: offset-based `"offset:N"`
- `totalCount` available from `Object.keys(versions).length`

### JSR (`JsrSource`)

- API: `GET /@{scope}/{name}/meta.json` returns a `versions` object
- Same approach as npm: client-side sort + slice

### Brew (`BrewSource`)

- **Not implemented** — Homebrew API only provides the latest version
- `fetchVersions` is not defined on this source

### Custom Manifest (`CustomManifestSource`)

- If the manifest contains a `versions` array/object field, list from it
- Otherwise, not supported

---

## 3. Downgrade Pipeline

Reuses the existing `Detection -> Check -> Plan -> Apply` pipeline with minimal changes.

### Planner changes

Add `targetVersion` option to `planUpdate`:

```typescript
planUpdate(
  status: UpdateStatus,
  detection: InstallDetection,
  config: ResolvedUpdateKitConfig,
  options?: {
    targetVersion?: string;
    assets?: AssetInfo[];
  }
): UpdatePlan | null;
```

- When `targetVersion` is set, plan generation uses that version instead of `status.latest`.
- Allows `current > target` (downgrade) — the version comparison guard is relaxed.
- All existing channel-based strategy selection remains unchanged.

### Channel strategies for downgrade

| Channel | Strategy | Details |
|---------|----------|---------|
| `native` | `native-in-place` | Download target version binary, atomic replace |
| `npm-global` | `delegate-command` | `npm install -g {pkg}@{targetVersion}` |
| `brew-cask` | `delegate-command` | `brew install --cask {name}` (limited version control) |
| `unmanaged` | `native-in-place` / `manual-install` | Depends on confidence |

### Applier changes

**None required.** The applier executes plans without checking version direction. `fromVersion` > `toVersion` is a valid state.

### Safety policy

- Same as upgrade: respects `delegateMode` setting
- Can use `execute` mode directly (per user requirement of "more freely")

---

## 4. Public API

### UpdateKit class methods

```typescript
class UpdateKit {
  // Existing methods unchanged...

  /** List available versions with pagination */
  listVersions(options?: {
    limit?: number;
    cursor?: string;
  }): Promise<VersionListResult>;

  /** Switch to a specific version (upgrade or downgrade).
      Full pipeline: detect -> plan -> apply */
  switchVersion(
    targetVersion: string,
    options?: { execute?: boolean }
  ): Promise<ApplyResult>;
}
```

#### `listVersions` behavior

1. Iterates configured sources in channel-priority order.
2. Calls `fetchVersions` on the first source that supports it.
3. Returns the result. If no source supports listing, returns `{ kind: 'error', reason: 'No source supports version listing' }`.

#### `switchVersion` behavior

1. `detectInstall()` — Determine channel.
2. Fetch version info for `targetVersion` from sources (to get assets, release URL, etc.).
3. `planUpdate()` with `targetVersion` option.
4. `applyUpdate()` — Execute the plan.
5. Returns `ApplyResult`.

### Standalone function

```typescript
export function listVersions(
  source: VersionSource,
  options?: FetchVersionsOptions
): Promise<VersionListResult>;
```

Direct access to a single source's version list, without UpdateKit orchestration.

---

## 5. Type Exports

New types added to public API:

```typescript
export type { FetchVersionsOptions, VersionListResult };
```

---

## 6. Testing Strategy

- Unit tests for each source's `fetchVersions` (mocked HTTP)
- Unit tests for planner with `targetVersion` (downgrade scenarios)
- Integration test for `listVersions` and `switchVersion` on UpdateKit class
- Edge cases: source doesn't support listing, empty version list, pagination boundaries, downgrade with low confidence detection

---

## Non-goals

- **No CLI commands** — update-kit CLI is for library maintainer diagnostics only
- **No version caching** — Version list is fetched fresh each time (blocking operation)
- **No CLI restructuring** — Existing CLI cleanup is a separate concern
