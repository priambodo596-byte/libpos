import assert from "node:assert/strict";
import { createDocument, parseDocument } from "../dist/index.js";

const document = createDocument();
const parsed = parseDocument(document);
assert.equal(parsed.ok, true, "a freshly created document should parse successfully");
assert.equal(parsed.document.schemaVersion, 1, "the document schema version should be 1");

const cyclic = {};
cyclic.self = cyclic;
const malformed = parseDocument(cyclic);
assert.equal(malformed.ok, false, "cyclic structures should return validation issues, not throw");
assert.ok(malformed.issues.length > 0, "malformed documents should include at least one issue");

console.log("ESM smoke passed: document creation, parsing, and malformed-input handling.");
