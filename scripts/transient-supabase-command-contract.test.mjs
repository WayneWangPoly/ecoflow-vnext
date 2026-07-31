import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTransientSupabaseFailure,
  parseTransientCommandArguments,
  retryAfterMilliseconds,
  retryDelayMilliseconds,
} from './run-transient-supabase-command.mjs';

test('classifies Supabase and Cloudflare 502 responses as transient', () => {
  assert.equal(
    isTransientSupabaseFailure('unexpected list functions status 502: error code: 502'),
    true,
  );
  assert.equal(
    isTransientSupabaseFailure('{"error_name":"origin_bad_gateway","status":502,"retryable":true,"retry_after":60}'),
    true,
  );
});

test('classifies rate limits and temporary network failures as transient', () => {
  for (const evidence of [
    'HTTP 429 Too Many Requests',
    'Service Unavailable',
    'connection reset by peer',
    'TLS handshake timeout',
    'EAI_AGAIN api.supabase.com',
  ]) {
    assert.equal(isTransientSupabaseFailure(evidence), true, evidence);
  }
});

test('does not retry deterministic migration and permission failures', () => {
  for (const evidence of [
    'ERROR: operator does not exist: text = uuid (SQLSTATE 42883)',
    'ERROR: permission denied to set parameter plpgsql.variable_conflict (SQLSTATE 42501)',
    'ERROR: cannot drop view because other objects depend on it (SQLSTATE 2BP01)',
    'Invalid project ref',
  ]) {
    assert.equal(isTransientSupabaseFailure(evidence), false, evidence);
  }
});

test('honours an upstream retry_after value without exceeding the cap', () => {
  assert.equal(retryAfterMilliseconds('{"retry_after":60}'), 60_000);
  assert.equal(retryAfterMilliseconds('Back off for at least 45 seconds.'), 45_000);
  assert.equal(
    retryDelayMilliseconds({
      attempt: 1,
      baseDelayMilliseconds: 20_000,
      maximumDelayMilliseconds: 120_000,
      output: '{"retry_after":60}',
    }),
    60_000,
  );
  assert.equal(
    retryDelayMilliseconds({
      attempt: 5,
      baseDelayMilliseconds: 20_000,
      maximumDelayMilliseconds: 120_000,
      output: '{"retry_after":900}',
    }),
    120_000,
  );
});

test('parses a bounded command without invoking a shell', () => {
  assert.deepEqual(
    parseTransientCommandArguments([
      '--label', 'Deploy route notification',
      '--log', 'supabase-migration-deploy.log',
      '--attempts', '5',
      '--base-delay-ms', '20000',
      '--max-delay-ms', '120000',
      '--',
      'supabase', 'functions', 'deploy', 'notify-route-start', '--project-ref', 'project-ref',
    ]),
    {
      attempts: 5,
      baseDelayMilliseconds: 20_000,
      maximumDelayMilliseconds: 120_000,
      label: 'Deploy route notification',
      logPath: 'supabase-migration-deploy.log',
      command: 'supabase',
      commandArguments: ['functions', 'deploy', 'notify-route-start', '--project-ref', 'project-ref'],
    },
  );
});

test('rejects missing commands and unsafe retry bounds', () => {
  assert.throws(
    () => parseTransientCommandArguments(['--attempts', '5']),
    /separator/,
  );
  assert.throws(
    () => parseTransientCommandArguments(['--attempts', '99', '--', 'supabase']),
    /1 to 8/,
  );
  assert.throws(
    () => parseTransientCommandArguments([
      '--base-delay-ms', '5000',
      '--max-delay-ms', '1000',
      '--', 'supabase',
    ]),
    /greater than or equal/,
  );
});
