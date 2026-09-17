import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260917013000_r5_004d_warehouse_adjustment_movement_contract.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const stocktake = fs.readFileSync('supabase/migrations/20260801163000_stocktake_transfer_controls.sql', 'utf8');
const inventoryMovement = fs.readFileSync('supabase/migrations/20260729120000_inventory_movement_and_daily_snapshot.sql', 'utf8');

const acceptedWarehouseMovementTypes = [
  'RECEIVE',
  'MOVE_IN',
  'MOVE_OUT',
  'ADJUST',
  'ADJUST_IN',
  'ADJUST_OUT',
  'PICK',
  'COUNT',
];

test('R5-004D widens only the warehouse movement type contract', () => {
  assert.match(
    migration,
    /alter table public\.ecoflow_warehouse_movements\s+drop constraint if exists ecoflow_warehouse_movements_movement_type_check;/i,
  );
  assert.match(
    migration,
    /add constraint ecoflow_warehouse_movements_movement_type_check\s+check\s*\(/i,
  );
  for (const movementType of acceptedWarehouseMovementTypes) {
    assert.ok(migration.includes(`'${movementType}'`), `missing warehouse movement type ${movementType}`);
  }
  assert.doesNotMatch(migration, /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\./i);
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function/i);
});

test('R5-004D preserves the stocktake approval directional adjustment semantics', () => {
  assert.match(
    stocktake,
    /v_movement:=case when v_delta>0 then 'ADJUST_IN' else 'ADJUST_OUT' end;/,
  );
  assert.match(stocktake, /insert into public\.ecoflow_warehouse_movements/);
  assert.match(stocktake, /insert into public\.ecoflow_inventory_movements/);
});

test('directional adjustment types already belong to the inventory movement contract', () => {
  assert.ok(inventoryMovement.includes("'ADJUST_IN'"));
  assert.ok(inventoryMovement.includes("'ADJUST_OUT'"));
});
