import assert from 'node:assert/strict';
import test from 'node:test';
import { loadManifest, validateManifest, assertSupplierBinding, assertExternalBinding, manifestDigest, sha256 } from './ordermentum-shadow-manifest.mjs';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
const manifest = loadManifest();

test('frozen manifest validates and has a stable digest', () => {
  const result = validateManifest(manifest);
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.equal(result.digest, manifestDigest(loadManifest()));
});

test('manifest rejects endpoint, cap and dynamic-window drift', () => {
  const endpoint = clone(manifest); endpoint.resources[0].list_path = 'https://evil.example/orders';
  assert.throws(() => validateManifest(endpoint), /Endpoint plan changed/);
  const cap = clone(manifest); cap.limits.max_gets_per_window = 39;
  assert.throws(() => validateManifest(cap), /Frozen limit changed/);
  const dynamic = clone(manifest); dynamic.windows[0].from = 'now()';
  assert.throws(() => validateManifest(dynamic), /Invalid frozen window|Dynamic/);
});

test('supplier and external exact-head bindings fail closed', () => {
  assert.equal(assertSupplierBinding(manifest, 'supplier-a', sha256('supplier-a')), sha256('supplier-a'));
  assert.throws(() => assertSupplierBinding(manifest, 'supplier-b', sha256('supplier-a')), /Supplier identity/);
  const candidate = 'a'.repeat(40); const digest = manifestDigest(manifest);
  assert.deepEqual(assertExternalBinding(manifest, { candidateSha: candidate, checkoutSha: candidate, currentMainSha: candidate, reviewedManifestDigest: digest }), { candidate_sha: candidate, manifest_sha256: digest });
  assert.throws(() => assertExternalBinding(manifest, { candidateSha: candidate, checkoutSha: 'b'.repeat(40), currentMainSha: candidate, reviewedManifestDigest: digest }), /Candidate/);
});
