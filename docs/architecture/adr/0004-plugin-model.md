# ADR 0004 — Plugin model

Status: accepted (Stage 1, contracts only). Runtime: Stage 2.

## Decision
A plugin is a `PluginDefinition` = `manifest` + optional `schema` extension + lifecycle hooks.

**Manifest**: `name`, `version`, `engines.core` (semver range of `CORE_API_VERSION` it supports),
`permissions[]`, optional `dependencies` on other plugins (name → range).

**Lifecycle** (status values in `PluginStatus`):
`registered → activating → active → deactivating → inactive`, with `failed` reachable from
`activating`/`active`. Registration validates compatibility and dependencies and applies the
schema extension; `activate(ctx)` receives a `PluginContext`; `deactivate()` must release
everything the plugin acquired. The runtime also tracks what a plugin registered (commands,
event subscriptions) and removes it on unregister, so a misbehaving plugin cannot leak.

**Compatibility checks**: reject registration if `engines.core` does not match
`CORE_API_VERSION`, a dependency is missing/incompatible, or a schema name clashes.

**Permissions**: capability names (e.g. `document:read`, `document:write`, `commands:register`,
`storage:write`, `network`). `PluginContext` exposes only the APIs the manifest declared; calling
anything else fails with a permission error.

## Honest limitation
Plugins run **in the same JavaScript realm** as the host. The permission model limits the API
surface handed to well-behaved plugins; it is **not a sandbox** against malicious code. Docs
must say so. Real isolation (iframes/workers) would be a separate design.
