import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/audit-warehouse-productisation.mjs';
const source = readFileSync(path, 'utf8');
const before = `assert.match(driverApp, /Take POD 1 · store / placement point/, 'DriverApp must natively request POD 1.');`;
const after = `assert.match(driverApp, /Take POD 1 · store \\/ placement point/, 'DriverApp must natively request POD 1.');`;
if (!source.includes(before)) throw new Error('POD 1 audit syntax target was not found.');
writeFileSync(path, source.replace(before, after), 'utf8');
console.log('Corrected POD 1 audit regex escaping.');
