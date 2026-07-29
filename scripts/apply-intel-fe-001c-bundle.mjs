import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const materialiser = 'scripts/materialise-intel-fe-001c.mjs';
const result = spawnSync(process.execPath, [materialiser], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
});

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const beginMarker = 'INTEL_FE_001C_BUNDLE_BEGIN';
const endMarker = 'INTEL_FE_001C_BUNDLE_END';
const begin = output.indexOf(beginMarker);
const end = output.indexOf(endMarker);
if (begin < 0 || end < 0 || end <= begin) {
  throw new Error(`INTEL_FE_001C_BUNDLE_NOT_FOUND\n${output}`);
}

const encoded = output.slice(begin + beginMarker.length, end).trim().replace(/\s+/g, '');
const bundle = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
for (const [relativePath, content] of Object.entries(bundle)) {
  const absolute = path.resolve(relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

fs.unlinkSync(materialiser);
fs.unlinkSync('scripts/apply-intel-fe-001c-bundle.mjs');
console.log('INTEL-FE-001C bundle written and temporary scripts removed.');
