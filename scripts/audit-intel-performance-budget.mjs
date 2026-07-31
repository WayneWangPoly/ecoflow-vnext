import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { intelligencePerformanceBudgets } from '../src/features/intelligence/analytics/programAssurance/programAssuranceContract.ts';

const dist = 'dist';
const assetsDirectory = path.join(dist, 'assets');
assert.ok(fs.existsSync(dist), 'INTEL-ASSURE-003 requires a completed Vite production bundle.');
assert.ok(fs.existsSync(assetsDirectory), 'INTEL-ASSURE-003 production assets directory is missing.');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

const assets = filesUnder(assetsDirectory).map((file) => ({
  file,
  bytes: fs.statSync(file).size,
  extension: path.extname(file).toLowerCase(),
}));
const javascript = assets.filter((asset) => asset.extension === '.js');
const css = assets.filter((asset) => asset.extension === '.css');
const indexHtmlBytes = fs.statSync(path.join(dist, 'index.html')).size;
const largestJavaScriptBytes = Math.max(0, ...javascript.map((asset) => asset.bytes));
const totalJavaScriptBytes = javascript.reduce((total, asset) => total + asset.bytes, 0);
const largestCssBytes = Math.max(0, ...css.map((asset) => asset.bytes));
const totalCssBytes = css.reduce((total, asset) => total + asset.bytes, 0);
const totalAssetCount = assets.length;

assert.ok(javascript.length > 0, 'INTEL-ASSURE-003 found no JavaScript production assets.');
assert.ok(css.length > 0, 'INTEL-ASSURE-003 found no CSS production assets.');
assert.ok(
  largestJavaScriptBytes <= intelligencePerformanceBudgets.largestJavaScriptBytes,
  `Largest JavaScript asset ${largestJavaScriptBytes} exceeds ${intelligencePerformanceBudgets.largestJavaScriptBytes} bytes.`,
);
assert.ok(
  totalJavaScriptBytes <= intelligencePerformanceBudgets.totalJavaScriptBytes,
  `Total JavaScript ${totalJavaScriptBytes} exceeds ${intelligencePerformanceBudgets.totalJavaScriptBytes} bytes.`,
);
assert.ok(
  largestCssBytes <= intelligencePerformanceBudgets.largestCssBytes,
  `Largest CSS asset ${largestCssBytes} exceeds ${intelligencePerformanceBudgets.largestCssBytes} bytes.`,
);
assert.ok(
  totalCssBytes <= intelligencePerformanceBudgets.totalCssBytes,
  `Total CSS ${totalCssBytes} exceeds ${intelligencePerformanceBudgets.totalCssBytes} bytes.`,
);
assert.ok(
  totalAssetCount <= intelligencePerformanceBudgets.totalAssetCount,
  `Production asset count ${totalAssetCount} exceeds ${intelligencePerformanceBudgets.totalAssetCount}.`,
);
assert.ok(
  indexHtmlBytes <= intelligencePerformanceBudgets.indexHtmlBytes,
  `index.html ${indexHtmlBytes} exceeds ${intelligencePerformanceBudgets.indexHtmlBytes} bytes.`,
);

console.log(JSON.stringify({
  gate: 'INTEL-ASSURE-003',
  largestJavaScriptBytes,
  totalJavaScriptBytes,
  largestCssBytes,
  totalCssBytes,
  totalAssetCount,
  indexHtmlBytes,
}, null, 2));
console.log('INTEL-ASSURE-003 Intelligence production bundle remains inside the approved performance budgets.');
