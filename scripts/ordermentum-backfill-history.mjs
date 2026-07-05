#!/usr/bin/env node
/*
  EcoFlow / Ordermentum historical backfill runner

  Purpose:
  - Safely backfill Ordermentum orders from a fixed historical start date to today.
  - Runs existing scripts/ordermentum-backfill-window.mjs repeatedly in small windows.
  - Supports summary-only mode first, then detail hydration mode.
  - Writes a local JSONL run log so failed windows can be reviewed.

  Required existing script:
  - scripts/ordermentum-backfill-window.mjs

  Required environment variables:
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - ORDERMENTUM_AUTH_MODE=legacy-bearer or api-key
  - ORDERMENTUM_BASE_URL
  - ORDERMENTUM_BEARER_TOKEN or ORDERMENTUM_API_KEY
  - ORDERMENTUM_SUPPLIER_ID
*/

import { spawn } from 'node:child_process';
import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);

function arg(name, fallback = null) {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return true;
  return value;
}

function has(name) {
  return args.includes(`--${name}`);
}

function env(name, required = false) {
  const value = process.env[name];
  if (required && !value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseDateUtc(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function maxDate(a, b) {
  return a.getTime() >= b.getTime() ? a : b;
}

function minDate(a, b) {
  return a.getTime() <= b.getTime() ? a : b;
}

function iso(date) {
  return date.toISOString().replace('.000Z', 'Z');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeAuthFailure(text) {
  return /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid token|expired/i.test(text);
}

function looksLikeApiKeyRequired(text) {
  return /api key required|x-api-key/i.test(text);
}

function runNodeScript(scriptPath, scriptArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function buildWindows({ from, to, daysPerWindow, direction }) {
  const windows = [];

  if (direction === 'forward') {
    let cursor = from;
    while (cursor.getTime() < to.getTime()) {
      const windowFrom = cursor;
      const windowTo = minDate(addDays(cursor, daysPerWindow), to);
      windows.push({ from: windowFrom, to: windowTo });
      cursor = windowTo;
    }
    return windows;
  }

  let cursor = to;
  while (cursor.getTime() > from.getTime()) {
    const windowTo = cursor;
    const windowFrom = maxDate(addDays(cursor, -daysPerWindow), from);
    windows.push({ from: windowFrom, to: windowTo });
    cursor = windowFrom;
  }
  return windows;
}

const todayUtcStart = startOfUtcDay(new Date());
const defaultTo = addDays(todayUtcStart, 1); // include today's orders by ending at tomorrow 00:00 UTC

const from = parseDateUtc(arg('from', '2024-11-01T00:00:00Z'), 'from');
const to = parseDateUtc(arg('to', iso(defaultTo)), 'to');
const daysPerWindow = Number(arg('days-per-window', has('detail') ? '1' : '7'));
const pageSize = Number(arg('page-size', has('detail') ? '10' : '20'));
const maxPages = Number(arg('max-pages', has('detail') ? '5' : '10'));
const delayMs = Number(arg('delay-ms', has('detail') ? '15000' : '8000'));
const retries = Number(arg('retries', '2'));
const direction = String(arg('direction', 'backward')).toLowerCase();
const continueOnError = has('continue-on-error');
const dryRun = has('dry-run');
const detail = has('detail');
const noSupabaseLog = has('no-supabase-log');
const stopOnAuthError = !has('continue-on-auth-error');

if (!Number.isFinite(daysPerWindow) || daysPerWindow <= 0) throw new Error('--days-per-window must be a positive number');
if (!Number.isFinite(pageSize) || pageSize <= 0) throw new Error('--page-size must be a positive number');
if (!Number.isFinite(maxPages) || maxPages <= 0) throw new Error('--max-pages must be a positive number');
if (!['forward', 'backward'].includes(direction)) throw new Error('--direction must be forward or backward');
if (from.getTime() >= to.getTime()) throw new Error('--from must be earlier than --to');

// Validate the environment early so the long job does not fail after many windows.
env('SUPABASE_URL', !noSupabaseLog && !dryRun);
env('SUPABASE_SERVICE_ROLE_KEY', !noSupabaseLog && !dryRun);
env('ORDERMENTUM_AUTH_MODE', true);
env('ORDERMENTUM_BASE_URL', true);
env('ORDERMENTUM_SUPPLIER_ID', true);
if (process.env.ORDERMENTUM_AUTH_MODE === 'api-key') env('ORDERMENTUM_API_KEY', true);
if (process.env.ORDERMENTUM_AUTH_MODE === 'legacy-bearer') env('ORDERMENTUM_BEARER_TOKEN', true);

// Helpful network defaults for Windows + long-running sync.
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--dns-result-order=ipv4first';
process.env.ORDERMENTUM_FETCH_TIMEOUT_MS = process.env.ORDERMENTUM_FETCH_TIMEOUT_MS || '60000';
process.env.SUPABASE_FETCH_TIMEOUT_MS = process.env.SUPABASE_FETCH_TIMEOUT_MS || '60000';
process.env.ORDERMENTUM_FETCH_RETRIES = process.env.ORDERMENTUM_FETCH_RETRIES || '3';

const scriptPath = path.resolve('scripts', 'ordermentum-backfill-window.mjs');
const windows = buildWindows({ from, to, daysPerWindow, direction });

await mkdir('logs', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join('logs', `ordermentum-history-backfill-${stamp}.jsonl`);

const summary = {
  mode: detail ? 'DETAIL' : 'SUMMARY_ONLY',
  dryRun,
  from: iso(from),
  to: iso(to),
  direction,
  daysPerWindow,
  pageSize,
  maxPages,
  delayMs,
  retries,
  totalWindows: windows.length,
  logPath,
};

console.log(JSON.stringify(summary, null, 2));
await appendFile(logPath, JSON.stringify({ type: 'START', at: new Date().toISOString(), ...summary }) + '\n');

let succeeded = 0;
let failed = 0;
let stopped = false;

for (let i = 0; i < windows.length; i += 1) {
  const window = windows[i];
  const windowLabel = `${iso(window.from)} -> ${iso(window.to)}`;
  console.log(`\n[${i + 1}/${windows.length}] Backfill window ${windowLabel}`);

  const windowArgs = [
    '--from', iso(window.from),
    '--to', iso(window.to),
    '--page-size', String(pageSize),
    '--max-pages', String(maxPages),
  ];

  if (dryRun) windowArgs.push('--dry-run');
  if (!detail) windowArgs.push('--fetch-detail', 'false');
  if (noSupabaseLog) windowArgs.push('--no-supabase-log');

  let attempt = 0;
  let success = false;
  let lastResult = null;

  while (attempt <= retries && !success) {
    attempt += 1;
    console.log(`[${i + 1}/${windows.length}] Attempt ${attempt}/${retries + 1}`);
    const result = await runNodeScript(scriptPath, windowArgs);
    lastResult = result;
    success = result.code === 0;

    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    if (!success) {
      const record = {
        type: 'WINDOW_ATTEMPT_FAILED',
        at: new Date().toISOString(),
        index: i + 1,
        totalWindows: windows.length,
        from: iso(window.from),
        to: iso(window.to),
        attempt,
        exitCode: result.code,
        stdoutTail: result.stdout.slice(-2000),
        stderrTail: result.stderr.slice(-2000),
      };
      await appendFile(logPath, JSON.stringify(record) + '\n');

      if (stopOnAuthError && (looksLikeAuthFailure(combinedOutput) || looksLikeApiKeyRequired(combinedOutput))) {
        console.error('Authentication/API-key failure detected. Stopping to avoid skipping many windows. Refresh token or obtain x-api-key, then rerun.');
        stopped = true;
        break;
      }

      if (attempt <= retries) {
        const wait = Math.min(60000, delayMs * attempt);
        console.log(`Window failed; waiting ${wait}ms before retry.`);
        await sleep(wait);
      }
    }
  }

  if (success) {
    succeeded += 1;
    await appendFile(logPath, JSON.stringify({
      type: 'WINDOW_SUCCEEDED',
      at: new Date().toISOString(),
      index: i + 1,
      totalWindows: windows.length,
      from: iso(window.from),
      to: iso(window.to),
      stdoutTail: lastResult?.stdout?.slice(-2000) || '',
    }) + '\n');
  } else {
    failed += 1;
    console.error(`Window failed after retries: ${windowLabel}`);
    if (!continueOnError || stopped) break;
  }

  if (i < windows.length - 1) {
    console.log(`Waiting ${delayMs}ms before next window...`);
    await sleep(delayMs);
  }
}

const final = {
  type: 'FINISH',
  at: new Date().toISOString(),
  mode: detail ? 'DETAIL' : 'SUMMARY_ONLY',
  succeeded,
  failed,
  stopped,
  totalWindows: windows.length,
  logPath,
};

await appendFile(logPath, JSON.stringify(final) + '\n');
console.log('\n' + JSON.stringify(final, null, 2));

if (failed > 0 || stopped) process.exitCode = 1;
