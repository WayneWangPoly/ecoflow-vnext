import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const ownerBundle = read('src/enhancers/OwnerEnhancers.tsx');
const accountBundle = read('src/enhancers/AccountEnhancers.tsx');
const ownershipDomain = read('src/domain/dataOwnership.ts');
const ownershipUi = read('src/CommercialSourceBoundary.tsx');
const priceUi = read('src/PriceMatrixWorkbench.tsx');
const priceRepo = read('src/data/repositories/priceMatrix.ts');
const storeRepo = read('src/data/repositories/storeIntelligence.ts');
const accountsUi = read('src/AccountsStatementWorkbench.tsx');
const accountsRepo = read('src/data/repositories/accountsStatement.ts');
const orderRepo = read('src/data/repositories/orderOperations.ts');
const mirror = read('scripts/ordermentum-complete-mirror.mjs');
const presence = read('scripts/finalise-ordermentum-source-presence.mjs');
const migration = read('supabase/migrations/20260714023000_commercial_source_boundary_v1.sql');
const statementFunction = read('supabase/functions/statement-dispatch/index.ts');
const runUi = read('src/DeliveryRunHistory.tsx');
const runRepo = read('src/data/repositories/runHistory.ts');
const deploy = read('.github/workflows/deploy-supabase-migrations.yml');

has(ownerBundle, 'CommercialSourceBoundary', 'Owner/Admin must receive the source ownership contract.');
has(accountBundle, 'CommercialSourceBoundary', 'Accounts must receive the source ownership contract.');
lacks(ownerBundle, 'PriceMatrixWorkbench', 'Owner bundle must not expose local price editing.');
lacks(accountBundle, 'PriceMatrixWorkbench', 'Accounts bundle must not expose local price editing.');
has(ownershipDomain, 'ORDERMENTUM_SOURCE_DOMAINS', 'Commercial ownership domains must be explicit.');
has(ownershipDomain, 'ECOFLOW_OPERATIONAL_DOMAINS', 'Operational ownership domains must be explicit.');
has(ownershipUi, 'One commercial source. One operational system.', 'The platform must explain the one-way source boundary.');
has(ownershipUi, 'SOURCE_MISSING', 'Source deletion must retain history rather than physically delete it.');

has(priceUi, 'ORDERMENTUM PRICE MIRROR · READ ONLY', 'Selling prices must be presented as a read-only mirror.');
has(priceUi, 'managed in Ordermentum', 'The price surface must direct changes to Ordermentum.');
lacks(priceUi, 'Save new version', 'Local price versions must not be editable.');
lacks(priceUi, 'Preview & apply', 'Local bulk price changes must not be exposed.');
has(priceRepo, 'ORDERMENTUM_SOURCE_OWNED', 'Price repository must reject local writes.');
lacks(priceRepo, ".rpc('ecoflow_set_price_matrix_price'", 'Price repository must not call the retired local price RPC.');
lacks(priceRepo, ".rpc('ecoflow_bulk_adjust_price_matrix'", 'Price repository must not call the retired bulk price RPC.');
has(storeRepo, 'SOURCE_OWNED_STORE_ACTIONS', 'Store repository must distinguish source-owned fields.');
has(storeRepo, 'ORDERMENTUM_SOURCE_OWNED', 'Store source fields must be rejected locally.');

has(accountsUi, 'VERIFIED ORDERMENTUM MIRROR', 'Accounts must identify Ordermentum as finance source.');
has(accountsUi, 'does not edit invoices, mark payments', 'Accounts must explain that finance facts are read-only.');
lacks(accountsUi, 'Allocate oldest invoices', 'EcoFlow must not allocate substitute customer payments.');
lacks(accountsUi, '<h4>Record payment</h4>', 'Local payment entry must be removed.');
has(accountsRepo, 'ORDERMENTUM_SOURCE_OWNED', 'Payment repository must reject local payment writes.');
lacks(accountsRepo, ".rpc('ecoflow_record_customer_payment'", 'Accounts repository must not call the retired payment RPC.');
has(accountsRepo, "functions.invoke('statement-dispatch'", 'Statement PDF/email must remain server-side.');
has(statementFunction, "['OWNER','ADMIN','ACCOUNT']", 'Only office roles may generate or send statements.');
lacks(statementFunction, 'body.recipient', 'Browser must not choose an arbitrary statement recipient.');
has(deploy, 'functions deploy statement-dispatch', 'Production deployment must include statement dispatch.');

has(migration, 'ecoflow_ordermentum_source_presence', 'Source presence must be durable.');
has(migration, 'ecoflow_reject_commercial_mirror_write', 'Database must reject source-mirror writes.');
has(migration, 'ecoflow_guard_store_source_fields', 'Database must protect Ordermentum store fields.');
has(migration, 'v_ecoflow_data_ownership_contract_v1', 'Data ownership must be queryable.');
has(migration, 'v_ecoflow_ordermentum_price_matrix_readonly_v1', 'Price view must ignore local overrides.');
has(migration, 'v_ecoflow_order_operations_v4', 'Operations must expose source presence.');
has(migration, 'v_ecoflow_ordermentum_mirror_health_v2', 'Mirror health must include source disappearance.');
has(migration, 'revoke execute on function', 'Legacy local commercial RPC execution must be revoked.');
has(mirror, 'finalise-ordermentum-source-presence.mjs', 'Complete mirror must finalise source presence.');
has(presence, 'SOURCE_MISSING', 'Full history reconciliation must mark disappeared source records.');
has(orderRepo, 'v_ecoflow_order_operations_v4', 'Orders must prefer the source-presence model.');
has(orderRepo, 'source_presence_status', 'Orders must expose source presence.');

has(ownerBundle, 'DeliveryRunHistory', 'Owner/Admin must retain delivery run history.');
has(accountBundle, 'DeliveryRunHistory', 'Accounts must retain delivery run history.');
has(runUi, 'Run history and replay', 'Delivery page must expose run history replay.');
has(runUi, 'Archive data is read-only', 'Historical runs must remain read-only.');
has(runRepo, 'v_ecoflow_delivery_run_catalog', 'Run history must load from server catalog.');

console.log('Ordermentum source ownership, EcoFlow operational writes, statements and run history audit passed.');
