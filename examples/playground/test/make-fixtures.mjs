// Writes the fixtures to artifacts/canvas-audit/fixtures and prints what the DOCX importer actually keeps.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importDocx } from '@convetlib/docx';
import { buildFixtureDocument, buildSingleSectionDocument, buildLongDocument, buildDocxBytes, toDotxBytes, regionSummary, duplicateIds } from './fixtures.mjs';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../artifacts/canvas-audit/fixtures');
fs.mkdirSync(out, { recursive: true });

const json = buildFixtureDocument();
fs.writeFileSync(path.join(out, 'fixture-multisection.json'), JSON.stringify(json, null, 2));
fs.writeFileSync(path.join(out, 'fixture-single.json'), JSON.stringify(buildSingleSectionDocument(), null, 2));

const docxBytes = await buildDocxBytes(buildSingleSectionDocument());
fs.writeFileSync(path.join(out, 'fixture-single.docx'), docxBytes);
fs.writeFileSync(path.join(out, 'fixture-single.dotx'), await toDotxBytes(docxBytes));
fs.writeFileSync(path.join(out, 'fixture-long.json'), JSON.stringify(buildLongDocument(), null, 2));
fs.writeFileSync(path.join(out, 'fixture-long.docx'), await buildDocxBytes(buildLongDocument()));
const multiDocx = await buildDocxBytes(json);
fs.writeFileSync(path.join(out, 'fixture-multisection.docx'), multiDocx);

for (const [label, bytes] of [['single.docx', docxBytes], ['single.dotx', fs.readFileSync(path.join(out, 'fixture-single.dotx'))], ['multisection.docx', multiDocx]]) {
  try {
    const doc = await importDocx(new Uint8Array(bytes), { title: label });
    console.log('IMPORT', label, 'sections=', doc.sections.length, 'dupIds=', JSON.stringify(duplicateIds(doc)));
    doc.sections.forEach((s, i) => console.log('  section', i, JSON.stringify(regionSummary(s))));
  } catch (e) { console.log('IMPORT FAILED', label, e.message); }
}
console.log('written to', out);
