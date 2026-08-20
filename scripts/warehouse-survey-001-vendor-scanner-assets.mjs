import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const ZXING_WASM_VERSION = '2.0.2';
const ZXING_BROWSER_VERSION = '0.2.1';
const REQUEST_TIMEOUT_MS = 20_000;

const readerScriptPath = `public/vendor/zxing-wasm/${ZXING_WASM_VERSION}/reader/index.js`;
const readerWasmPath = `public/vendor/zxing-wasm/${ZXING_WASM_VERSION}/reader/zxing_reader.wasm`;
const legacyScriptPath = `public/vendor/zxing-browser/${ZXING_BROWSER_VERSION}/zxing-browser.min.js`;

const sources = {
  readerScript: [
    `https://cdn.jsdelivr.net/npm/zxing-wasm@${ZXING_WASM_VERSION}/dist/iife/reader/index.js`,
    `https://unpkg.com/zxing-wasm@${ZXING_WASM_VERSION}/dist/iife/reader/index.js`,
  ],
  readerWasm: [
    `https://cdn.jsdelivr.net/npm/zxing-wasm@${ZXING_WASM_VERSION}/dist/reader/zxing_reader.wasm`,
    `https://unpkg.com/zxing-wasm@${ZXING_WASM_VERSION}/dist/reader/zxing_reader.wasm`,
  ],
  legacyScript: [
    `https://cdn.jsdelivr.net/npm/@zxing/browser@${ZXING_BROWSER_VERSION}/umd/zxing-browser.min.js`,
    `https://unpkg.com/@zxing/browser@${ZXING_BROWSER_VERSION}/umd/zxing-browser.min.js`,
  ],
};

async function fetchPinnedAsset(label, urls) {
  const failures = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('empty response');
      return { bytes, url };
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to vendor ${label}. ${failures.join(' | ')}`);
}

function validateReaderScript(bytes) {
  const text = bytes.toString('utf8');
  if (!text.includes('ZXingWASM') || !text.includes(ZXING_WASM_VERSION) || !text.includes('readBarcodes')) {
    throw new Error('Pinned ZXing-WASM reader script failed identity validation.');
  }
  const embeddedSha256 = [...text.matchAll(/["'`]([a-f0-9]{64})["'`]/gi)].map((match) => match[1].toLowerCase());
  if (!embeddedSha256.length) throw new Error('Pinned ZXing-WASM reader script does not expose an embedded WASM SHA-256.');
  return { text, embeddedSha256 };
}

function validateReaderWasm(bytes, embeddedSha256) {
  const hasWasmMagic = bytes.length > 800_000
    && bytes[0] === 0x00
    && bytes[1] === 0x61
    && bytes[2] === 0x73
    && bytes[3] === 0x6d;
  if (!hasWasmMagic) throw new Error('Pinned ZXing-WASM binary failed size or WebAssembly magic validation.');

  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (!embeddedSha256.includes(actualSha256)) {
    throw new Error(`ZXing-WASM binary SHA-256 ${actualSha256} does not match the pinned reader script.`);
  }
  return actualSha256;
}

function validateLegacyScript(bytes) {
  const text = bytes.toString('utf8');
  if (!text.includes('ZXingBrowser') || bytes.length < 25_000) {
    throw new Error('Pinned legacy ZXing browser fallback failed identity validation.');
  }
  return text;
}

async function writeAsset(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

const readerScript = await fetchPinnedAsset('ZXing-WASM reader script', sources.readerScript);
const readerScriptIdentity = validateReaderScript(readerScript.bytes);
const readerWasm = await fetchPinnedAsset('ZXing-WASM reader binary', sources.readerWasm);
const readerWasmSha256 = validateReaderWasm(readerWasm.bytes, readerScriptIdentity.embeddedSha256);
const legacyScript = await fetchPinnedAsset('legacy ZXing browser fallback', sources.legacyScript);
validateLegacyScript(legacyScript.bytes);

await Promise.all([
  writeAsset(readerScriptPath, readerScript.bytes),
  writeAsset(readerWasmPath, readerWasm.bytes),
  writeAsset(legacyScriptPath, legacyScript.bytes),
]);

console.log(`Vendored ZXing-WASM ${ZXING_WASM_VERSION} reader (${readerWasmSha256.slice(0, 12)}…) and ZXing Browser ${ZXING_BROWSER_VERSION} fallback into public/vendor.`);
