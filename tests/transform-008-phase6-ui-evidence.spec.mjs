import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const TARGET_URL = process.env.TARGET_URL;
if (!TARGET_URL) throw new Error('TARGET_URL is required.');

const PROJECT_REF = 'kauqwlzuyxcudoyognwf';
const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || 'artifacts/transform-008-phase6-ui';
const NOW = '2026-08-14T06:30:00.000Z';

mkdirSync(EVIDENCE_DIR, { recursive: true });
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

const roleProfiles = {
  OWNER: { user_id: '00000000-0000-4000-8000-000000000201', email: 'phase6-owner@example.invalid', display_name: 'Phase 6 Owner', app_role: 'OWNER' },
  VIEWER: { user_id: '00000000-0000-4000-8000-000000000202', email: 'phase6-viewer@example.invalid', display_name: 'Phase 6 Viewer', app_role: 'VIEWER' },
};

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function fakeAccessToken(userId) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ aud: 'authenticated', exp, sub: userId, role: 'authenticated' })}.phase6-evidence-signature`;
}

function sessionFor(profile) {
  const user = {
    id: profile.user_id,
    aud: 'authenticated',
    role: 'authenticated',
    email: profile.email,
    email_confirmed_at: NOW,
    phone: '',
    confirmed_at: NOW,
    last_sign_in_at: NOW,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { display_name: profile.display_name, app_role: profile.app_role },
    identities: [],
    created_at: NOW,
    updated_at: NOW,
  };
  return {
    access_token: fakeAccessToken(profile.user_id),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `phase6-${profile.app_role.toLowerCase()}-refresh`,
    user,
  };
}

function activeProfile(profile) {
  return {
    ...profile,
    team_status: 'ACTIVE',
    is_active: true,
    invited_at: null,
    accepted_at: NOW,
    last_seen_at: NOW,
  };
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

function savedViewFixture(profile) {
  return [{
    saved_view_id: '00000000-0000-4000-8000-000000000260',
    workspace: 'analytics',
    name: 'Phase 6 governed view',
    view_state: {
      filters: [],
      sort: null,
      visibleColumns: ['metric', 'state', 'freshness', 'quality'],
      dateRange: null,
      comparisonSettings: [],
      searchTerm: null,
    },
    scope: 'PRIVATE',
    role_scope: null,
    is_role_default: false,
    version: 1,
    can_manage_role_defaults: profile.app_role === 'OWNER',
    updated_at: NOW,
    read_at: NOW,
  }];
}

const comparisonFixture = [{
  candidate_kind: 'CUSTOMER',
  entity_id: 'STORE-E2E-001',
  label: 'Phase 6 Café',
  context: { suburb: 'Adelaide', source: 'server-authorised-evidence' },
  permission: 'ALLOWED',
  read_at: NOW,
}];

const exportFixture = [{
  export_kind: 'TABLE_VIEW',
  dataset_key: 'COMPARISON_CANDIDATES',
  filename_base: 'ecoflow-comparison-candidates',
  generated_at: NOW,
  columns: [
    { key: 'entity_id', label: 'Entity ID' },
    { key: 'label', label: 'Label' },
  ],
  row_index: 1,
  row_data: { entity_id: 'STORE-E2E-001', label: 'Phase 6 Café' },
}];

async function installSupabaseBoundary(context, appRole) {
  const profile = roleProfiles[appRole];
  const session = sessionFor(profile);
  const forbiddenBusinessWrites = [];
  const authoritativeReads = [];

  await context.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: AUTH_STORAGE_KEY, value: session });

  await context.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/v1/user')) return json(route, session.user);
    if (path.endsWith('/auth/v1/token')) return json(route, session);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    return json(route, {});
  });

  await context.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body = {};
    try { body = JSON.parse(request.postData() || '{}'); } catch { body = {}; }

    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (path.endsWith('/rest/v1/v_ecoflow_current_user')) return json(route, activeProfile(profile));

    if (path.endsWith('/rest/v1/v_ecoflow_analytics_health')) return json(route, null);
    if (path.endsWith('/rest/v1/v_ecoflow_analytics_refresh_status')) return json(route, []);
    if (path.endsWith('/rest/v1/v_ecoflow_analytics_data_quality')) return json(route, []);
    if (path.endsWith('/rest/v1/v_ecoflow_analytics_metric_catalog')) return json(route, []);

    if (path.endsWith('/rest/v1/rpc/get_intelligence_saved_views')) {
      authoritativeReads.push({ rpc: 'get_intelligence_saved_views', body });
      return json(route, savedViewFixture(profile));
    }
    if (path.endsWith('/rest/v1/rpc/ecoflow_read_comparison_candidates_v1')) {
      authoritativeReads.push({ rpc: 'ecoflow_read_comparison_candidates_v1', body });
      return json(route, comparisonFixture);
    }
    if (path.endsWith('/rest/v1/rpc/ecoflow_read_authoritative_export_v1')) {
      authoritativeReads.push({ rpc: 'ecoflow_read_authoritative_export_v1', body });
      return json(route, exportFixture);
    }

    const mutationRpc = /\/rpc\/(apply_intelligence_saved_view_command|ecoflow_set_account_release_hold_v1|ecoflow_recover_account_hold_command_v1|ecoflow_record_return_disposition_v1|ecoflow_close_return_v1|ecoflow_recover_return_command_v1|ecoflow_commit_actionable_exception_lifecycle)$/;
    if (mutationRpc.test(path)) {
      forbiddenBusinessWrites.push({ method: request.method(), path, body });
      return json(route, { message: 'Mutation forbidden in TRANSFORM-008 Phase 6 UI evidence.' }, 409);
    }

    // Other app bootstrap reads are intentionally empty, deterministic and intercepted.
    return json(route, []);
  });

  await context.route('**/functions/v1/**', (route) => json(route, { message: 'Function network disabled in deterministic UI evidence.' }, 503));
  return { forbiddenBusinessWrites, authoritativeReads };
}

async function diagnosePage(page, appRole, stage) {
  const body = await page.locator('body').innerText().catch(() => '<body unavailable>');
  const storage = await page.evaluate((key) => ({
    hasAuthStorage: window.localStorage.getItem(key) !== null,
    authStoragePrefix: (window.localStorage.getItem(key) || '').slice(0, 180),
    localKeys: Object.keys(window.localStorage),
    sessionKeys: Object.keys(window.sessionStorage),
  }), AUTH_STORAGE_KEY).catch(() => ({ hasAuthStorage: false, authStoragePrefix: '', localKeys: [], sessionKeys: [] }));
  const sidebarButtons = await page.locator('.sidebar-nav button').evaluateAll((nodes) => nodes.map((node) => ({
    text: node.textContent?.trim() ?? '',
    tag: node.tagName,
    disabled: 'disabled' in node ? Boolean(node.disabled) : false,
    ariaHidden: node.getAttribute('aria-hidden'),
  }))).catch(() => []);
  console.log(`PHASE6_UI_DIAGNOSTIC_ROLE=${appRole}`);
  console.log(`PHASE6_UI_DIAGNOSTIC_STAGE=${stage}`);
  console.log(`PHASE6_UI_DIAGNOSTIC_URL=${page.url()}`);
  console.log(`PHASE6_UI_DIAGNOSTIC_AUTH_STORAGE=${JSON.stringify(storage)}`);
  console.log(`PHASE6_UI_DIAGNOSTIC_SIDEBAR_BUTTONS=${JSON.stringify(sidebarButtons)}`);
  console.log(`PHASE6_UI_DIAGNOSTIC_BODY=${body.slice(0, 4000).replaceAll('\n', ' | ')}`);
  await page.screenshot({ path: `${EVIDENCE_DIR}/diagnostic-${appRole.toLowerCase()}-${stage}.png`, fullPage: true }).catch(() => null);
}

async function openRole(browser, appRole, viewport) {
  const navigationViewport = viewport.width < 1000 ? { width: 1440, height: 1000 } : viewport;
  const context = await browser.newContext({ viewport: navigationViewport });
  const network = await installSupabaseBoundary(context, appRole);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // The production-default bundle does not force the overlay-navigation feature
  // flag. Prove the actual user path instead: authenticate into the desktop shell,
  // select the real Analytics sidebar control, then verify the governed workspace.
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  try {
    const analyticsButton = page.locator('.sidebar-nav button').filter({ hasText: /^Analytics$/ });
    await expect(analyticsButton).toHaveCount(1, { timeout: 25_000 });
    await expect(analyticsButton).toBeVisible();
    await analyticsButton.click();
    await expect(page.getByRole('heading', { name: 'Health & readiness', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Personal operating workspace', exact: true })).toBeVisible({ timeout: 15_000 });
    if (viewport.width < 1000) {
      await page.setViewportSize(viewport);
    }
  } catch (error) {
    await diagnosePage(page, appRole, 'open-analytics');
    throw error;
  }
  return { context, page, pageErrors, ...network };
}

async function provePhase6Surface(page) {
  await expect(page.getByRole('heading', { name: 'Saved Views', exact: true })).toBeVisible();
  await expect(page.getByText('Phase 6 governed view', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quick Actions', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Comparison Tray', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Authoritative Export', exact: true })).toBeVisible();
  await expect(page.getByText('Phase 6 Café', { exact: true })).toBeVisible({ timeout: 5000 });

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await expect(page.getByText('Selected comparison entities', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Command palette/ }).click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

test('Owner reaches all governed Phase 6 productivity capabilities through the real Analytics workspace control', async ({ browser }) => {
  const state = await openRole(browser, 'OWNER', { width: 1440, height: 1000 });
  try {
    await provePhase6Surface(state.page);

    const downloadPromise = state.page.waitForEvent('download');
    await state.page.getByRole('button', { name: 'Export current governed table', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('ecoflow-comparison-candidates-2026-08-14.csv');
    await expect(state.page.getByText(/1 authoritative row\(s\) exported/)).toBeVisible();

    const rpcNames = state.authoritativeReads.map((entry) => entry.rpc);
    expect(rpcNames).toContain('get_intelligence_saved_views');
    expect(rpcNames).toContain('ecoflow_read_comparison_candidates_v1');
    expect(rpcNames).toContain('ecoflow_read_authoritative_export_v1');
    expect(state.forbiddenBusinessWrites, 'Phase 6 evidence must remain mutation-free').toEqual([]);
    expect(state.pageErrors, 'Phase 6 deployed bundle must not throw runtime page errors').toEqual([]);

    await state.page.screenshot({ path: `${EVIDENCE_DIR}/owner-analytics-phase6-desktop.png`, fullPage: true });
  } finally {
    await state.context.close();
  }
});

test('Viewer retains read-only Phase 6 access without role-default authority or business mutation', async ({ browser }) => {
  const state = await openRole(browser, 'VIEWER', { width: 1440, height: 1000 });
  try {
    await provePhase6Surface(state.page);
    await expect(state.page.getByLabel('Role default target')).toHaveCount(0);
    expect(state.forbiddenBusinessWrites).toEqual([]);
    expect(state.pageErrors).toEqual([]);
    await state.page.screenshot({ path: `${EVIDENCE_DIR}/viewer-analytics-phase6-desktop.png`, fullPage: true });
  } finally {
    await state.context.close();
  }
});

test('Owner Phase 6 productivity surface remains responsive at mobile width', async ({ browser }) => {
  const state = await openRole(browser, 'OWNER', { width: 390, height: 844 });
  try {
    await expect(state.page.getByRole('heading', { name: 'Saved Views', exact: true })).toBeVisible();
    await expect(state.page.getByRole('heading', { name: 'Comparison Tray', exact: true })).toBeVisible();
    await expect(state.page.getByRole('heading', { name: 'Authoritative Export', exact: true })).toBeVisible();
    expect(state.forbiddenBusinessWrites).toEqual([]);
    expect(state.pageErrors).toEqual([]);
    await state.page.screenshot({ path: `${EVIDENCE_DIR}/owner-analytics-phase6-mobile.png`, fullPage: true });
  } finally {
    await state.context.close();
  }
});
