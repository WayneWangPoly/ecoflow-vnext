#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseArgs(argv) {
  const passthrough = [];
  let script = 'scripts/ordermentum-incremental-sync.mjs';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--script') {
      script = argv[i + 1];
      i += 1;
    } else {
      passthrough.push(arg);
    }
  }
  return { script, passthrough };
}

async function loginLegacy() {
  const username = env('ORDERMENTUM_USERNAME');
  const password = env('ORDERMENTUM_PASSWORD');
  const baseUrl = process.env.ORDERMENTUM_BASE_URL || 'https://app.ordermentum.com';
  const timeoutMs = Number(process.env.ORDERMENTUM_AUTH_TIMEOUT_MS || process.env.ORDERMENTUM_FETCH_TIMEOUT_MS || 45000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) {
      throw new Error(`Ordermentum legacy auth ${response.status}: ${text}`);
    }
    const token = payload.access_token || payload.token || payload.accessToken;
    if (!token) {
      throw new Error(`Ordermentum legacy auth succeeded but no access token was returned. Response keys: ${Object.keys(payload).join(', ')}`);
    }
    return { token, baseUrl };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { script, passthrough } = parseArgs(process.argv.slice(2));
  env('SUPABASE_URL');
  env('SUPABASE_SERVICE_ROLE_KEY');
  env('ORDERMENTUM_SUPPLIER_ID');

  const { token, baseUrl } = await loginLegacy();
  const childEnv = {
    ...process.env,
    ORDERMENTUM_AUTH_MODE: 'legacy-bearer',
    ORDERMENTUM_BASE_URL: baseUrl,
    ORDERMENTUM_BEARER_TOKEN: token,
  };

  console.log(JSON.stringify({
    action: 'legacy_token_loaded',
    baseUrl,
    tokenLength: token.length,
    script,
    args: passthrough,
  }, null, 2));

  const child = spawn(process.execPath, [script, ...passthrough], {
    stdio: 'inherit',
    env: childEnv,
    shell: false,
  });

  const code = await new Promise((resolve) => {
    child.on('close', resolve);
    child.on('error', (err) => {
      console.error(err);
      resolve(1);
    });
  });

  process.exit(code ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
