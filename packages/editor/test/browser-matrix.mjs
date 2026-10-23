import { spawnSync } from "node:child_process";
import process from "node:process";

const browsers = ["chromium", "firefox", "webkit"];
for (const browser of browsers) {
  console.log("\n=== Browser integration: " + browser + " ===");
  const result = spawnSync(process.execPath, ["test/browser.integration.mjs"], {
    stdio: "inherit",
    env: { ...process.env, CONVETLIB_BROWSER: browser }
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("Browser integration failed for " + browser + " (exit " + result.status + ").");
    process.exit(result.status ?? 1);
  }
}
console.log("\nAll browser integration suites passed.");
