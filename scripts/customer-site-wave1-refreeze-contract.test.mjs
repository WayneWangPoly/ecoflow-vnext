import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const manifestPath = 'docs/engineering/evidence/340B-2-R1-customer-site-wave1-refreeze.manifest';
const source = fs.readFileSync(manifestPath, 'utf8');
const lines = source.split(/\r?\n/);

function sha256(linesToHash) {
  return crypto.createHash('sha256').update(linesToHash.join('\n')).digest('hex');
}

function byteSort(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function metadata(key) {
  const prefix = `${key}=`;
  const row = lines.find((line) => line.startsWith(prefix));
  assert.ok(row, `missing metadata ${key}`);
  return row.slice(prefix.length);
}

function section(name) {
  const marker = `[${name}]`;
  const start = lines.indexOf(marker);
  assert.notEqual(start, -1, `missing section ${marker}`);
  const rows = [];
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.startsWith('[')) break;
    rows.push(line.split('\t'));
  }
  return rows;
}

const customers = section('customers');
const sites = section('sites');
const customerByCode = new Map(customers.map((row) => [row[0], row]));

const customerLine = (row) => row.join('|');
const siteLine = (row) => row.join('|');

const sortedCustomers = [...customers].sort((a, b) => byteSort(a[0], b[0]));
const sortedSites = [...sites].sort((a, b) => byteSort(`${a[0]}|${a[1]}`, `${b[0]}|${b[1]}`));

test('manifest is pinned to the exact post-340B-1 protected base and contains no PII payload fields', () => {
  assert.equal(metadata('schema_version'), '1');
  assert.equal(metadata('protected_base'), 'fca385593ee2f3d7ac4ef8ef0ce8751468db51f1');
  assert.equal(metadata('previous_drift_checkpoint'), '5683944229');
  assert.equal(lines[lines.indexOf('[customers]') + 1], 'customer_code\tordermentum_purchaser_id\tmatch_method\tdisposition');
  assert.equal(lines[lines.indexOf('[sites]') + 1], 'parent_customer_code\tunleashed_address_guid\tordermentum_purchaser_id\tdisposition');
  assert.doesNotMatch(source, /@/);
  assert.doesNotMatch(source, /\b(?:street|suburb|postcode|postal_code|phone|email|customer_name|store_name)\b/i);
});

test('Customer evidence is exactly 90 rows with 82 AUTO and four 2-to-1 purchaser collisions held closed', () => {
  assert.equal(customers.length, 90);
  assert.equal(new Set(customers.map((row) => row[0])).size, 90);
  assert.equal(customers.filter((row) => row[3] === 'AUTO').length, 82);
  assert.equal(customers.filter((row) => row[3] === 'HOLD_DUPLICATE_EXTERNAL_ID').length, 8);
  assert.ok(customers.every((row) => row.length === 4));
  assert.ok(customers.every((row) => ['EMAIL_NAME', 'EMAIL_PHONE'].includes(row[2])));
  assert.ok(customers.every((row) => ['AUTO', 'HOLD_DUPLICATE_EXTERNAL_ID'].includes(row[3])));

  const byPurchaser = new Map();
  for (const row of customers) {
    const list = byPurchaser.get(row[1]) ?? [];
    list.push(row);
    byPurchaser.set(row[1], list);
  }
  assert.equal(byPurchaser.size, 86);
  const duplicates = [...byPurchaser.values()].filter((rows) => rows.length > 1);
  assert.equal(duplicates.length, 4);
  assert.ok(duplicates.every((rows) => rows.length === 2));
  assert.ok(duplicates.flat().every((row) => row[3] === 'HOLD_DUPLICATE_EXTERNAL_ID'));
  assert.ok([...byPurchaser.values()].filter((rows) => rows.length === 1).every((rows) => rows[0][3] === 'AUTO'));
});

test('Customer membership hashes reproduce the frozen 90 evidence rows and 82 AUTO rows', () => {
  assert.equal(
    sha256(sortedCustomers.map(customerLine)),
    metadata('customer_membership_90_sha256'),
  );
  assert.equal(metadata('customer_membership_90_sha256'), '645d02193e4e2f240406971e0f41a5be8f1b14ffc3f28621fdc9c564ab95adbe');

  const auto = sortedCustomers.filter((row) => row[3] === 'AUTO');
  assert.equal(sha256(auto.map(customerLine)), metadata('customer_membership_82_sha256'));
  assert.equal(metadata('customer_membership_82_sha256'), '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3');
});

test('Site membership is exactly 76 parent-scoped items: 71 AUTO, four duplicate-parent HOLD, one location HOLD', () => {
  assert.equal(sites.length, 76);
  assert.equal(new Set(sites.map((row) => row[1])).size, 76);
  assert.equal(sites.filter((row) => row[3] === 'AUTO').length, 71);
  assert.equal(sites.filter((row) => row[3] === 'HOLD_DUPLICATE_PARENT').length, 4);
  assert.equal(sites.filter((row) => row[3] === 'HOLD_LOCATION_CONFLICT').length, 1);
  assert.ok(sites.every((row) => row.length === 4));

  const locationHold = sites.find((row) => row[3] === 'HOLD_LOCATION_CONFLICT');
  assert.deepEqual(locationHold, [
    'CUST-00000296',
    '4b2b3942-0f08-4abe-87da-4f4b81afc835',
    'b27e8d09-9606-4c92-9a8b-d4e7ada20580',
    'HOLD_LOCATION_CONFLICT',
  ]);

  for (const site of sites) {
    const parent = customerByCode.get(site[0]);
    assert.ok(parent, `site parent ${site[0]} is not in Customer evidence`);
    assert.equal(site[2], parent[1], `site purchaser does not match parent ${site[0]}`);
    if (site[3] === 'AUTO' || site[3] === 'HOLD_LOCATION_CONFLICT') assert.equal(parent[3], 'AUTO');
    if (site[3] === 'HOLD_DUPLICATE_PARENT') assert.equal(parent[3], 'HOLD_DUPLICATE_EXTERNAL_ID');
  }
});

test('Site membership hashes reproduce the 76 scoped items and 71 AUTO items', () => {
  assert.equal(sha256(sortedSites.map(siteLine)), metadata('site_membership_76_sha256'));
  assert.equal(metadata('site_membership_76_sha256'), '4e964f0441778f52aded3cdfe671733f16feb191d8c8d44a8d9e2d647fe84fd2');

  const auto = sortedSites.filter((row) => row[3] === 'AUTO');
  assert.equal(sha256(auto.map(siteLine)), metadata('site_membership_71_sha256'));
  assert.equal(metadata('site_membership_71_sha256'), '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af');
});

test('source-evidence hashes are frozen separately for R2 stale-evidence verification', () => {
  const expected = {
    customer_source_evidence_90_sha256: '9f19583c405d9d8f31574067ce0aa6eaa13f6e0ef8ac71bd184322324778ee65',
    customer_source_evidence_82_sha256: 'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7',
    customer_duplicate_hold_8_sha256: 'e437b043fb858099de1651241ec89f70e8c53a552123832ae41e590122e25b3b',
    site_source_evidence_75_sha256: '67f16299aea8327632fdeac30bb531563dc5776d0e805e7facbac75bac1bd459',
    site_source_evidence_71_sha256: 'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a',
    site_duplicate_parent_hold_4_sha256: 'a34c230a7c4659494e2300ba0b34bbcf9bb3960a9c63b85cf0241321b4f839cc',
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(metadata(key), value);
});
