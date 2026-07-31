import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { intelligenceCanonicalSmokeRoutes } from '../src/features/intelligence/analytics/programAssurance/programAssuranceContract.ts';

const host = '127.0.0.1';
const port = 4173;
const origin = `http://${host}:${port}`;
let output = '';

const preview = spawn(process.execPath, [
  './node_modules/vite/bin/vite.js',
  'preview',
  '--host', host,
  '--port', String(port),
  '--strictPort',
], {
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

preview.stdout.on('data', (chunk) => { output += chunk.toString(); });
preview.stderr.on('data', (chunk) => { output += chunk.toString(); });

async function waitForPreview() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (preview.exitCode !== null) throw new Error(`Vite preview exited before smoke checks.\n${output}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Vite preview did not become ready.\n${output}`);
}

try {
  await waitForPreview();
  for (const route of intelligenceCanonicalSmokeRoutes) {
    const response = await fetch(`${origin}${route}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3_000),
      headers: { accept: 'text/html' },
    });
    assert.equal(response.status, 200, `Canonical route ${route} returned HTTP ${response.status}.`);
    const html = await response.text();
    assert.match(html, /id=["']root["']/, `Canonical route ${route} did not serve the application root.`);
    assert.ok(!html.includes('Cannot GET'), `Canonical route ${route} returned a server routing failure.`);
  }
  console.log(`INTEL-ASSURE-004 canonical deep-route smoke passed: ${intelligenceCanonicalSmokeRoutes.length} / ${intelligenceCanonicalSmokeRoutes.length} routes.`);
} finally {
  preview.kill('SIGTERM');
  await new Promise((resolve) => {
    if (preview.exitCode !== null) {
      resolve();
      return;
    }
    preview.once('exit', resolve);
    setTimeout(() => {
      if (preview.exitCode === null) preview.kill('SIGKILL');
      resolve();
    }, 2_000).unref();
  });
}
