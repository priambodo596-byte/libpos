/**
 * Version of the public plugin/adapter API. Plugins declare a semver range of this value in
 * `manifest.engines.core`. Bump the minor version for additive changes and the major version
 * for breaking ones (while 0.x, a minor bump may also break; see docs).
 */
export const CORE_API_VERSION = "0.1.0" as const;
