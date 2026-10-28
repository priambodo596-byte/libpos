import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as api from "../src/index";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(pkgDir, "src");

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listSources(full) : full.endsWith(".ts") ? [full] : [];
  });
}

/** Removes comments so that prose mentioning "DOM" or "React" does not trip the checks. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const sources = listSources(srcDir).map((file) => ({ file: relative(pkgDir, file).replaceAll("\\", "/"), code: stripComments(readFileSync(file, "utf8")) }));

describe("@convetlib/core architecture rules (ADR 0001)", () => {
  it("finds the source files it is supposed to check", () => {
    expect(sources.length).toBeGreaterThanOrEqual(15);
  });

  it("imports only relative modules: zero runtime dependencies, no React/Next/Node built-ins", () => {
    const offenders: string[] = [];
    for (const { file, code } of sources) {
      const specifiers = [...code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const s of specifiers) if (!s.startsWith(".")) offenders.push(`${file}: ${s}`);
    }
    expect(offenders).toEqual([]);
  });

  it("does not use browser or Node globals", () => {
    const forbidden = /(?<![.\w$])(window|document|localStorage|sessionStorage|navigator|indexedDB|process|Buffer|require|__dirname)\s*[.(\[]/;
    const offenders = sources.filter(({ code }) => forbidden.test(code)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("declares no runtime dependencies in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as Record<string, unknown>;
    expect(pkg["dependencies"]).toBeUndefined();
    expect(pkg["peerDependencies"]).toBeUndefined();
  });
});

describe("public API surface", () => {
  it("exports exactly the documented runtime values (guards accidental API changes)", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "CORE_API_VERSION",
        "CORE_MARK_SPECS",
        "CORE_NODE_SPECS",
        "DocumentVersionError",
        "MAX_NODE_DEPTH",
        "MigrationRegistry",
        "SCHEMA_VERSION",
        "Schema",
        "cloneDocument",
        "cloneJson",
        "coreSchema",
        "createDocument",
        "createEditor",
        "createNodeFactory",
        "createSection",
        "createSequentialIdGenerator",
        "defaultIdGenerator",
        "defaultMigrations",
        "defaultPageSetup",
        "isBlockNode",
        "isTextNode",
        "parseDocument",
        "resolveSectionHeaderFooter",
        "sectionUsesEvenPageVariant",
        "sectionUsesFirstPageVariant",
      ].sort(),
    );
  });
});
