#!/usr/bin/env node

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const transientSupabaseFailurePatterns = [
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /bad gateway/i,
  /gateway timeout/i,
  /service unavailable/i,
  /origin_bad_gateway/i,
  /unexpected list functions status/i,
  /rate[ -]?limit/i,
  /too many requests/i,
  /temporar(?:y|ily) unavailable/i,
  /connection (?:reset|refused|closed)/i,
  /server closed the connection/i,
  /network (?:error|failure)/i,
  /socket hang up/i,
  /timed? out/i,
  /timeout/i,
  /econnreset/i,
  /econnrefused/i,
  /enetunreach/i,
  /eai_again/i,
  /unexpected eof/i,
  /tls handshake timeout/i,
];

export function isTransientSupabaseFailure(output) {
  const text = typeof output === 'string' ? output : String(output ?? '');
  return transientSupabaseFailurePatterns.some((pattern) => pattern.test(text));
}

export function retryAfterMilliseconds(output) {
  const text = typeof output === 'string' ? output : String(output ?? '');
  const matches = [
    text.match(/["']?retry_after["']?\s*[:=]\s*["']?(\d{1,5})/i),
    text.match(/retry-after\s*[:=]\s*(\d{1,5})/i),
    text.match(/back off for at least\s+(\d{1,5})\s+seconds/i),
  ].filter(Boolean);
  if (!matches.length) return null;
  const seconds = Math.max(...matches.map((match) => Number(match[1])));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : null;
}

export function retryDelayMilliseconds({
  attempt,
  baseDelayMilliseconds,
  maximumDelayMilliseconds,
  output = '',
}) {
  const exponent = Math.max(0, attempt - 1);
  const exponential = Math.min(
    maximumDelayMilliseconds,
    baseDelayMilliseconds * (2 ** exponent),
  );
  const serverDelay = retryAfterMilliseconds(output) ?? 0;
  return Math.min(maximumDelayMilliseconds, Math.max(exponential, serverDelay));
}

function positiveInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

export function parseTransientCommandArguments(argv) {
  const options = {
    attempts: 5,
    baseDelayMilliseconds: 20_000,
    maximumDelayMilliseconds: 120_000,
    label: 'Supabase command',
    logPath: null,
    command: null,
    commandArguments: [],
  };

  const separator = argv.indexOf('--');
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error('Command separator `--` and a command are required.');
  }

  const flags = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (flag === '--attempts') {
      options.attempts = positiveInteger(value, '--attempts', 1, 8);
      index += 1;
    } else if (flag === '--base-delay-ms') {
      options.baseDelayMilliseconds = positiveInteger(value, '--base-delay-ms', 100, 300_000);
      index += 1;
    } else if (flag === '--max-delay-ms') {
      options.maximumDelayMilliseconds = positiveInteger(value, '--max-delay-ms', 100, 600_000);
      index += 1;
    } else if (flag === '--label') {
      if (!value || value.length > 120) throw new Error('--label must contain 1 to 120 characters.');
      options.label = value;
      index += 1;
    } else if (flag === '--log') {
      if (!value || value.length > 500) throw new Error('--log must contain a bounded file path.');
      options.logPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (options.maximumDelayMilliseconds < options.baseDelayMilliseconds) {
    throw new Error('--max-delay-ms must be greater than or equal to --base-delay-ms.');
  }
  options.command = command[0];
  options.commandArguments = command.slice(1);
  return options;
}

function appendLog(path, text) {
  if (!path) return;
  fs.appendFileSync(path, text, 'utf8');
}

async function runCommandAttempt(command, commandArguments, logPath) {
  let captured = '';
  let spawnError = null;
  const child = spawn(command, commandArguments, {
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  const consume = (stream, destination) => {
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      destination.write(text);
      appendLog(logPath, text);
      captured = `${captured}${text}`.slice(-262_144);
    });
  };
  consume(child.stdout, process.stdout);
  consume(child.stderr, process.stderr);
  child.on('error', (error) => {
    spawnError = error;
    const text = `${error.name}: ${error.message}\n`;
    process.stderr.write(text);
    appendLog(logPath, text);
    captured = `${captured}${text}`.slice(-262_144);
  });

  const exitCode = await new Promise((resolve) => {
    child.once('close', (code) => resolve(code ?? 1));
  });
  return { exitCode, output: captured, spawnError };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runTransientSupabaseCommand(options) {
  const {
    attempts,
    baseDelayMilliseconds,
    maximumDelayMilliseconds,
    label,
    logPath,
    command,
    commandArguments,
  } = options;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const header = `\n=== ${label}: attempt ${attempt}/${attempts} ===\n`;
    process.stdout.write(header);
    appendLog(logPath, header);

    const result = await runCommandAttempt(command, commandArguments, logPath);
    if (result.exitCode === 0) {
      const success = `${label} succeeded on attempt ${attempt}.\n`;
      process.stdout.write(success);
      appendLog(logPath, success);
      return { attemptsUsed: attempt, status: 'SUCCEEDED' };
    }

    const spawnCode = result.spawnError && typeof result.spawnError === 'object'
      ? String(result.spawnError.code ?? '')
      : '';
    const evidence = `${result.output}\n${spawnCode}`;
    const transient = isTransientSupabaseFailure(evidence);
    if (!transient || attempt === attempts) {
      const reason = transient ? 'transient retry budget exhausted' : 'non-transient failure';
      const failure = `${label} failed on attempt ${attempt}: ${reason}.\n`;
      process.stderr.write(failure);
      appendLog(logPath, failure);
      const error = new Error(failure.trim());
      error.exitCode = result.exitCode || 1;
      error.transient = transient;
      throw error;
    }

    const delay = retryDelayMilliseconds({
      attempt,
      baseDelayMilliseconds,
      maximumDelayMilliseconds,
      output: result.output,
    });
    const notice = `${label} encountered a transient upstream failure; retrying in ${Math.ceil(delay / 1_000)}s.\n`;
    process.stdout.write(notice);
    appendLog(logPath, notice);
    await sleep(delay);
  }

  throw new Error(`${label} retry loop ended unexpectedly.`);
}

async function main() {
  try {
    const options = parseTransientCommandArguments(process.argv.slice(2));
    await runTransientSupabaseCommand(options);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error && typeof error === 'object' && Number.isInteger(error.exitCode)
      ? error.exitCode
      : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
