import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cloudPath = '.github/workflows/ordermentum-cloud-sync.yml';
const mirrorPath = '.github/workflows/ordermentum-complete-mirror.yml';

const [cloud, mirror] = await Promise.all([
  readFile(cloudPath, 'utf8'),
  readFile(mirrorPath, 'utf8'),
]);

function cronValues(source) {
  return [...source.matchAll(/- cron:\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

test('operational Ordermentum sync is scheduled exactly four times daily', () => {
  assert.deepEqual(cronValues(cloud), ['7 4,12,16,22 * * *']);
  assert.match(cloud, /SYNC_MODE=orders_invoices/);
  assert.match(cloud, /Scheduled four-times-daily high-watermark order and invoice delta/);
  assert.doesNotMatch(cloud, /7,37 \* \* \* \*/);
});

test('automatic catchup by repository push is removed while manual catchup remains', () => {
  assert.doesNotMatch(cloud, /\n\s*push:\s*\n/);
  assert.match(cloud, /- catchup/);
  assert.doesNotMatch(cloud, /github\.event_name.*push/);
});

test('cloud sync artifacts retain only one day', () => {
  const matches = [...cloud.matchAll(/retention-days:\s*(\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual(matches, [1]);
});

test('Complete Mirror performs weekly recent reconciliation only', () => {
  assert.deepEqual(cronValues(mirror), ['30 17 * * 0']);
  assert.match(mirror, /MIRROR_MODE=recent/);
  assert.match(mirror, /Weekly recent commercial reconciliation/);
  assert.doesNotMatch(mirror, /Daily recent commercial reconciliation/);
});

test('post-deploy Complete Mirror is verification-only and does not fetch data', () => {
  assert.match(mirror, /github\.event_name.*workflow_run/);
  assert.match(mirror, /MIRROR_MODE=verify_only/);
  assert.match(mirror, /Lightweight verification after successful Supabase production deployment/);
  assert.match(mirror, /--mode="\$MIRROR_MODE"/);
});

test('full history remains manual-only', () => {
  assert.match(mirror, /- full_history/);
  assert.match(mirror, /inputs\.scope/);
  assert.match(mirror, /MIRROR_MODE=resume_history/);
  const scheduledSection = mirror.slice(mirror.indexOf('elif [ "${{ github.event_name }}" = "schedule" ]'));
  assert.doesNotMatch(scheduledSection.split('else')[0], /resume_history|full_history/);
});

test('Complete Mirror artifacts retain only one day and push self-trigger is removed', () => {
  const matches = [...mirror.matchAll(/retention-days:\s*(\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual(matches, [1]);
  assert.doesNotMatch(mirror, /\n\s*push:\s*\n/);
});
