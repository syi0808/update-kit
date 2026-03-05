# Plugin & Marketplace Design

**Date**: 2026-03-05
**Status**: Approved

## Goal

Convert the existing `integrating-update-kit` skill into a Claude Code plugin and create a marketplace within this repository for distribution.

## Directory Structure

```
update-kit/
├── .claude-plugin/
│   └── marketplace.json              # marketplace catalog
├── plugins/
│   └── update-kit-plugin/
│       ├── .claude-plugin/
│       │   └── plugin.json           # plugin manifest
│       ├── skills/
│       │   └── integrating-update-kit/
│       │       ├── SKILL.md
│       │       └── references/
│       │           ├── api-reference.md
│       │           └── integration-patterns.md
│       ├── commands/
│       │   └── doctor.md             # /update-kit:doctor command
│       └── agents/
│           └── integration-reviewer.md  # integration code review agent
```

## Components

### 1. Plugin Manifest (`plugin.json`)

```json
{
  "name": "update-kit",
  "description": "Integrates update-kit into CLI projects for self-update and version notification. Provides integration skill, diagnostic doctor command, and code review agent.",
  "version": "0.1.1",
  "author": {
    "name": "syi0808"
  },
  "homepage": "https://github.com/syi0808/update-kit",
  "repository": "https://github.com/syi0808/update-kit",
  "license": "Apache-2.0",
  "keywords": ["update", "self-update", "cli", "version-check", "auto-update"]
}
```

### 2. Marketplace (`marketplace.json`)

```json
{
  "name": "update-kit-marketplace",
  "owner": {
    "name": "syi0808"
  },
  "metadata": {
    "description": "Plugin marketplace for update-kit CLI self-update toolkit"
  },
  "plugins": [
    {
      "name": "update-kit",
      "source": "./plugins/update-kit-plugin",
      "description": "Integrates update-kit into CLI projects for self-update and version notification",
      "category": "developer-tools",
      "tags": ["update", "cli", "self-update", "version"]
    }
  ]
}
```

### 3. Skill: `integrating-update-kit`

Migrated from `.claude/skills/integrating-update-kit/`. Contains:
- `SKILL.md` — 5-step integration workflow
- `references/api-reference.md` — Full API documentation
- `references/integration-patterns.md` — 7 integration patterns (A-G)

Invoked as `/update-kit:integrating-update-kit`.

### 4. Command: `doctor.md`

Diagnostic command for projects that already have update-kit integrated.

Checks:
- `update-kit` is in `dependencies` (not devDependencies)
- Import/require syntax matches project module system
- Version source configuration is valid
- ESM/CJS module system alignment
- `checkAndNotify()` or `autoUpdate()` call exists
- Banner output goes to stderr

Invoked as `/update-kit:doctor`.

### 5. Agent: `integration-reviewer.md`

Subagent that reviews existing update-kit integration code.

Review criteria:
- API usage follows best practices
- Error handling is appropriate
- Banner output goes to stderr (not stdout)
- Version source matches actual distribution channel
- Delegate mode is appropriate for the use case

Used as a subagent for code review or invoked via `/update-kit:integration-reviewer`.

## Migration Notes

- Existing `.claude/skills/integrating-update-kit/` can be removed after plugin is set up (plugin version takes precedence)
- Plugin is hosted within this repo using relative path source in marketplace.json
- Users install via: `/plugin marketplace add syi0808/update-kit` then `/plugin install update-kit@update-kit-marketplace`
