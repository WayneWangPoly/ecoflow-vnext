import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const TARGET_URL = process.env.TARGET_URL;
if (!TARGET_URL) throw new Error('TARGET_URL is required.');

const PROJECT_REF = 'kauqwlzuyxcudoyognwf';
const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || 'artifacts/transform-007-phase5-ui';
const NOW = '2026-08-13T04:30:00.000Z';

mkdirSync(EVIDENCE_DIR, { recursive: true });
test.use({ viewport: { width: 1440, height: 1000 } });
test.describe.configure({ mode: 'serial' });

const roleProfiles = {
  OWNER: { user_id: '00000000-0000-4000-8000-000000000101', email: 'phase5-owner@example.invalid', display_name: 'Phase 5 Owner', app_role: 'OWNER' },
  ACCOUNT: { user_id: '00000000-0000-4000-8000-000000000102', email: 'phase5-account@example.invalid', display_name: 'Phase 5 Account', app_role: 'ACCOUNT' },
  VIEWER: { user_id: '00000000-0000-4000-8000-000000000103', email: 'phase5-viewer@example.invalid', display_name: 'Phase 5 Viewer', app_role: 'VIEWER' },
};

const records = {
  inventory: {
    id: 'SKU-E2E-12W',
    row: {
      sku: 'SKU-E2E-12W', product_name: '12oz Compostable Cup', authoritative_on_hand: 420,
      stock_authority: 'WAREHOUSE_LEDGER', inventory_signal: 'HEALTHY', reorder_target: 250, units_30d: 178,
    },
    summary: { total_skus: 1, below_target: 0, inconsistent: 0 },
    detail: [
      { record_kind: 'SUMMARY', record_data: { sku: 'SKU-E2E-12W', product_name: '12oz Compostable Cup', authoritative_on_hand: 420, inventory_signal: 'HEALTHY' }, read_at: NOW },
      { record_kind: 'LOCATION', record_data: { location_code: 'A1-01', on_hand_location: 420, unit_level: 'CASE' }, read_at: NOW },
      { record_kind: 'MOVEMENT', record_data: { id: 'MOVE-E2E-001', movement_type: 'RECEIPT', quantity: 100, to_location: 'A1-01', moved_at: NOW }, read_at: NOW },
    ],
  },
  customers: {
    id: 'STORE-E2E-001',
    row: {
      store_id: 'STORE-E2E-001', store_name: 'Phase 5 Café', suburb: 'Adelaide', price_group_id: 'TIER-A',
      orders_30d: 12, revenue_30d: 1840.5, store_signal: 'ACTIVE', account_hold_active: false,
    },
    summary: { active_stores: 1, orders_30d: 12, revenue_30d: 1840.5 },
    detail: [
      { record_kind: 'SUMMARY', record_data: { store_id: 'STORE-E2E-001', store_name: 'Phase 5 Café', suburb: 'Adelaide', store_signal: 'ACTIVE' }, read_at: NOW },
      { record_kind: 'ORDER', record_data: { order_number: 'ORD-E2E-001', status: 'APPROVED', total_value: 212.5, ordered_at: NOW }, read_at: NOW },
      { record_kind: 'CONTACT', record_data: { contact_name: 'Evidence Contact', email: 'contact@example.invalid' }, read_at: NOW },
    ],
  },
  accounts: {
    id: 'STORE-E2E-001',
    row: {
      store_id: 'STORE-E2E-001', store_name: 'Phase 5 Café', accounts_priority: 'NORMAL', open_statement_value: 212.5,
      overdue_statement_value: 0, worst_overdue_days: 0, hold_active: false, hold_reason: null,
    },
    summary: { open_statement_value: 212.5, overdue_statement_value: 0, held_stores: 0 },
    detail: [
      { record_kind: 'SUMMARY', record_data: { store_id: 'STORE-E2E-001', store_name: 'Phase 5 Café', release_authority: 'OWNER / ADMIN / ACCOUNT', hold_active: false }, read_at: NOW },
      { record_kind: 'INVOICE', record_data: { invoice_number: 'INV-E2E-001', outstanding_amount: 212.5, statement_status: 'OPEN', due_at: NOW }, read_at: NOW },
      { record_kind: 'AFFECTED_ORDER', record_data: { order_number: 'ORD-E2E-001', warehouse_gate_status: 'RELEASED' }, read_at: NOW },
    ],
  },
  returns: {
    id: 'RET-E2E-001',
    row: {
      id: 'RETURN-E2E-ID', return_code: 'RET-E2E-001', store_name: 'Phase 5 Café', order_number: 'ORD-E2E-001',
      lifecycle_stage: 'INSPECTED', return_status: 'RETURNED_TO_WAREHOUSE', inventory_consequence_status: 'EXPLICIT',
      account_consequence_status: 'NOT_REQUIRED', recorded_at: NOW,
    },
    summary: { open_returns: 1, missing_consequence: 0, closed_returns: 0 },
    detail: [
      { record_kind: 'SUMMARY', record_data: { exception_id: 'RETURN-E2E-ID', return_code: 'RET-E2E-001', store_name: 'Phase 5 Café', lifecycle_stage: 'INSPECTED', return_status: 'RETURNED_TO_WAREHOUSE', inventory_consequence_status: 'EXPLICIT' }, read_at: NOW },
      { record_kind: 'INSPECTION', record_data: { id: 'INSPECT-E2E-001', disposition: 'RESTOCK', quantity_packages: 1, barcode: 'BAR-E2E-001', inspected_at: NOW }, read_at: NOW },
      { record_kind: 'INVENTORY_CONSEQUENCE', record_data: { movement_id: 'MOVE-E2E-RET-001', movement_type: 'RETURN_IN', target_location: 'A1-RETURNS' }, read_at: NOW },
    ],
  },
};

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function fakeAccessToken(userId) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ aud: 'authenticated', exp, sub: userId, role: 'authenticated' })}.phase5-evidence-signature`;
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
    refresh_token: `phase5-${profile.app_role.toLowerCase()}-refresh`,
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

async function installSupabaseBoundary(context, appRole) {
  const profile = roleProfiles[appRole];
  const session = sessionFor(profile);
  const forbiddenBusinessWrites = [];
  const unexpectedRestCalls = [];

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
    const url = new URL(request.url());
    const path = url.pathname;
    const rawBody = request.postData() || '{}';
    let body = {};
    try { body = JSON.parse(rawBody); } catch { body = {}; }

    if (path.endsWith('/rest/v1/v_ecoflow_current_user')) return json(route, activeProfile(profile));

    if (path.endsWith('/rest/v1/rpc/ecoflow_read_operational_records_v1')) {
      const workspace = String(body.p_workspace || '');
      const fixture = records[workspace];
      if (!fixture) return json(route, []);
      return json(route, [{ total_count: 1, row_data: fixture.row, summary_data: fixture.summary, read_at: NOW }]);
    }

    if (path.endsWith('/rest/v1/rpc/ecoflow_read_operational_record_detail_v1')) {
      const workspace = String(body.p_workspace || '');
      return json(route, records[workspace]?.detail || []);
    }

    if (path.endsWith('/rest/v1/rpc/ecoflow_read_account_hold_state_v1')) {
      return json(route, [{
        store_id: records.accounts.id,
        active: false,
        revision: 7,
        hold_reason: null,
        source_action_id: null,
        updated_by: profile.user_id,
        updated_at: NOW,
      }]);
    }

    if (path.endsWith('/rest/v1/rpc/ecoflow_read_return_state_v1')) {
      return json(route, [{
        exception_id: 'RETURN-E2E-ID',
        return_code: records.returns.id,
        return_status: 'RETURNED_TO_WAREHOUSE',
        lifecycle_stage: 'INSPECTED',
        physically_received: true,
        revision: 4,
        inspection_line_count: 1,
        dispositions: ['RESTOCK'],
        inventory_consequence_status: 'EXPLICIT',
        latest_inventory_movement_id: 'MOVE-E2E-RET-001',
        warehouse_location: 'A1-RETURNS',
        updated_at: NOW,
        inspection_completed_at: NOW,
      }]);
    }

    const businessWriteRpc = /\/rpc\/(ecoflow_set_account_release_hold_v1|ecoflow_recover_account_hold_command_v1|ecoflow_record_return_disposition_v1|ecoflow_close_return_v1|ecoflow_recover_return_command_v1)$/;
    if (businessWriteRpc.test(path)) {
      forbiddenBusinessWrites.push({ method: request.method(), path });
      return json(route, { message: 'Business mutation forbidden in Phase 5 UI evidence.' }, 409);
    }

    unexpectedRestCalls.push({ method: request.method(), path });
    return json(route, []);
  });

  await context.route('**/functions/v1/**', (route) => json(route, { message: 'Function network disabled in deterministic UI evidence.' }, 503));
  return { forbiddenBusinessWrites, unexpectedRestCalls };
}

async function openRole(browser, appRole) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const network = await installSupabaseBoundary(context, appRole);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { context, page, pageErrors, ...network };
}

async function diagnosePage(page, path) {
  const body = await page.locator('body').innerText().catch(() => '<body unavailable>');
  const storage = await page.evaluate((key) => ({
    hasAuthStorage: window.localStorage.getItem(key) !== null,
    authStoragePrefix: (window.localStorage.getItem(key) || '').slice(0, 180),
    keys: Object.keys(window.localStorage),
  }), AUTH_STORAGE_KEY).catch(() => ({ hasAuthStorage: false, authStoragePrefix: '', keys: [] }));
  console.log(`PHASE5_UI_DIAGNOSTIC_PATH=${path}`);
  console.log(`PHASE5_UI_DIAGNOSTIC_URL=${page.url()}`);
  console.log(`PHASE5_UI_DIAGNOSTIC_AUTH_STORAGE=${JSON.stringify(storage)}`);
  console.log(`PHASE5_UI_DIAGNOSTIC_BODY=${body.slice(0, 3000).replaceAll('\n', ' | ')}`);
  await page.screenshot({ path: `${EVIDENCE_DIR}/diagnostic-${path.replaceAll('/', '-') || 'root'}.png`, fullPage: true }).catch(() => null);
}

async function expectWorkspace(page, path, heading) {
  await page.goto(new URL(path, TARGET_URL).href, { waitUntil: 'domcontentloaded' });
  const locator = page.getByRole('heading', { name: heading, exact: true });
  try {
    await expect(locator).toBeVisible({ timeout: 15000 });
  } catch (error) {
    await diagnosePage(page, path);
    throw error;
  }
  await expect(page.getByText('1 exact records')).toBeVisible();
}

async function captureListAndDetail(page, workspace, heading, recordLabel, screenshotPrefix) {
  await expectWorkspace(page, `/${workspace}`, heading);
  await page.screenshot({ path: `${EVIDENCE_DIR}/${screenshotPrefix}-list.png`, fullPage: true });
  await page.getByRole('link', { name: recordLabel, exact: true }).first().click();
  await expect(page.getByLabel(`${heading} record detail`)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${EVIDENCE_DIR}/${screenshotPrefix}-detail.png`, fullPage: true });
}

test('Owner deployed bundle renders all four Phase 5 list/detail surfaces without business mutation', async ({ browser }) => {
  const state = await openRole(browser, 'OWNER');
  try {
    await captureListAndDetail(state.page, 'inventory', 'Inventory', 'SKU-E2E-12W', 'owner-inventory');
    await captureListAndDetail(state.page, 'customers', 'Customers', 'Phase 5 Café', 'owner-customers');
    await captureListAndDetail(state.page, 'accounts', 'Accounts', 'Phase 5 Café', 'owner-accounts');
    await expect(state.page.getByLabel('Account hold command')).toBeVisible();
    await captureListAndDetail(state.page, 'returns', 'Returns', 'RET-E2E-001', 'owner-returns');
    await expect(state.page.getByLabel('Return command authority')).toBeVisible();

    expect(state.forbiddenBusinessWrites, 'UI evidence must never invoke 007B/007C mutations').toEqual([]);
    expect(state.pageErrors, 'deployed bundle must not throw runtime page errors').toEqual([]);
  } finally {
    await state.context.close();
  }
});

test('Owner, Account and Viewer deployed route matrix remains fail closed', async ({ browser }) => {
  const matrix = {
    OWNER: { allow: [['/inventory', 'Inventory'], ['/customers', 'Customers'], ['/accounts', 'Accounts'], ['/returns', 'Returns']], deny: [] },
    ACCOUNT: { allow: [['/customers', 'Customers'], ['/accounts', 'Accounts']], deny: ['/inventory', '/returns'] },
    VIEWER: { allow: [['/inventory', 'Inventory'], ['/customers', 'Customers']], deny: ['/accounts', '/returns'] },
  };

  for (const [appRole, expected] of Object.entries(matrix)) {
    const state = await openRole(browser, appRole);
    try {
      for (const [path, heading] of expected.allow) await expectWorkspace(state.page, path, heading);
      for (const path of expected.deny) {
        await state.page.goto(new URL(path, TARGET_URL).href, { waitUntil: 'domcontentloaded' });
        await expect(state.page.getByRole('heading', { name: 'Workspace not authorised', exact: true })).toBeVisible({ timeout: 10000 });
      }
      if (appRole === 'VIEWER') {
        await state.page.goto(new URL('/accounts', TARGET_URL).href, { waitUntil: 'domcontentloaded' });
        await expect(state.page.getByRole('heading', { name: 'Workspace not authorised', exact: true })).toBeVisible();
        await state.page.screenshot({ path: `${EVIDENCE_DIR}/viewer-accounts-denied.png`, fullPage: true });
      }
      expect(state.forbiddenBusinessWrites).toEqual([]);
      expect(state.pageErrors).toEqual([]);
    } finally {
      await state.context.close();
    }
  }
});
