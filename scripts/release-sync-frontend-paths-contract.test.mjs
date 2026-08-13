import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hasFrontendChanges } from './release-sync-frontend-paths.mjs';

const workflow = readFileSync(new URL('../.github/workflows/release-sync-authority.yml', import.meta.url), 'utf8');

test('frontend path classifier covers release-bearing files', () => {
  assert.equal(hasFrontendChanges(['src/features/example.tsx']), true);
  assert.equal(hasFrontendChanges(['public/favicon.svg']), true);
  assert.equal(hasFrontendChanges(['index.html']), true);
  assert.equal(hasFrontendChanges(['package.json']), true);
  assert.equal(hasFrontendChanges(['package-lock.json']), true);
  assert.equal(hasFrontendChanges(['vite.config.ts']), true);
  assert.equal(hasFrontendChanges(['tsconfig.json']), true);
  assert.equal(hasFrontendChanges(['vercel.json']), true);
});

test('frontend path classifier ignores non-release files', () => {
  assert.equal(hasFrontendChanges(['docs/release.md', '.github/workflows/check.yml']), false);
});

test('authoritative workflow compares merge commits to their first parent', () => {
  assert.match(workflow, /git rev-list --parents -n 1 "\$TARGET_SHA"/);
  assert.match(workflow, /git diff --name-only "\$FIRST_PARENT" "\$TARGET_SHA"/);
  assert.doesNotMatch(workflow, /git diff-tree --no-commit-id --name-only -r HEAD/);
});

test('authoritative workflow runs after the database deployment workflow', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \['Deploy Supabase migrations'\]/);
  assert.match(workflow, /context='Release sync'/);
});
