import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const ownerBundle = read('src/enhancers/OwnerEnhancers.tsx');
const accountBundle = read('src/enhancers/AccountEnhancers.tsx');
const priceUi = read('src/PriceMatrixWorkbench.tsx');
const priceRepo = read('src/data/repositories/priceMatrix.ts');
const accountsUi = read('src/AccountsStatementWorkbench.tsx');
const accountsRepo = read('src/data/repositories/accountsStatement.ts');
const runUi = read('src/DeliveryRunHistory.tsx');
const runRepo = read('src/data/repositories/runHistory.ts');
const migration = read('supabase/migrations/20260711190000_commercial_controls.sql');
const statementFunction = read('supabase/functions/statement-dispatch/index.ts');
const deploy = read('.github/workflows/deploy-supabase-migrations.yml');

has(ownerBundle, 'PriceMatrixWorkbench', 'Owner/Admin must receive the commercial price matrix.');
has(accountBundle, 'PriceMatrixWorkbench', 'Accounts must receive the read-only commercial matrix.');
has(priceUi, 'Read-only commercial view', 'Non-owner price matrix must remain read-only.');
has(priceUi, 'does not silently push prices back to Ordermentum', 'Price matrix must not claim automatic Ordermentum write-back.');
has(priceRepo, 'ecoflow_set_price_matrix_price', 'Price changes must use controlled RPC.');
has(migration, 'uq_ecoflow_price_matrix_current', 'Only one current price version may exist per SKU and tier.');
has(migration, 'PRICE_CHANGE_REASON_REQUIRED', 'Every price change must require a reason.');
has(migration, "v_role not in ('OWNER','ADMIN')", 'Accounts must not edit price versions.');

has(accountsUi, 'Generate & send', 'Accounts must expose formal statement generation and sending.');
has(accountsUi, 'Allocate oldest invoices', 'Payments must be allocated through the formal workbench.');
has(accountsRepo, "functions.invoke('statement-dispatch'", 'Statement PDF/email must stay server-side.');
has(accountsRepo, 'ecoflow_record_customer_payment', 'Payment recording must use controlled RPC.');
has(migration, 'unique(store_id,payment_reference)', 'Payment retries must be idempotent per customer reference.');
has(migration, 'v_ecoflow_accounts_live_statement_lines', 'Payment allocations must reduce live invoice balances.');
has(migration, "values('account-statements','account-statements',false)", 'Statement storage must be private.');
has(statementFunction, "['OWNER','ADMIN','ACCOUNT']", 'Only office roles may generate or send statements.');
has(statementFunction, 'attachments:', 'Formal statements must be attached to customer email.');
has(deploy, 'functions deploy statement-dispatch', 'Production deployment must include statement dispatch.');
lacks(statementFunction, 'body.recipient', 'Browser must not be allowed to select an arbitrary statement recipient.');

has(ownerBundle, 'DeliveryRunHistory', 'Owner/Admin must receive delivery run history.');
has(accountBundle, 'DeliveryRunHistory', 'Accounts must receive delivery run history.');
has(runUi, 'Run history and replay', 'Delivery page must expose run history replay.');
has(runUi, 'Archive data is read-only', 'Historical runs must remain read-only.');
has(runRepo, 'v_ecoflow_delivery_run_catalog', 'Run history must load from server catalog.');
has(migration, 'v_ecoflow_delivery_run_stop_history', 'Run A/B/C stop histories must remain separate.');
has(migration, "'RUN-'||replace(g.business_day,'-','')||'-'||g.run_code", 'Historical route IDs must preserve run code.');

console.log('Commercial pricing, statements, payment reconciliation and run history audit passed.');
