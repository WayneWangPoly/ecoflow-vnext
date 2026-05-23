import type { Warehouse, WarehouseZone } from '@/core/types/database';
import { SEED_NOW } from './seedTime';

export const seedWarehouses: Warehouse[] = [
  {
    id: 'wh-main',
    code: 'MAIN',
    name: 'EcoFlow Main Warehouse',
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedWarehouseZones: WarehouseZone[] = [
  { id: 'zone-inbound', warehouseId: 'wh-main', code: 'INBOUND', name: 'Inbound / Receiving', sortOrder: 10, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'zone-a1', warehouseId: 'wh-main', code: 'A1', name: 'A1 Zone', sortOrder: 20, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'zone-a2', warehouseId: 'wh-main', code: 'A2', name: 'A2 Zone', sortOrder: 30, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'zone-a3', warehouseId: 'wh-main', code: 'A3', name: 'A3 Zone', sortOrder: 40, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'zone-a4', warehouseId: 'wh-main', code: 'A4', name: 'A4 Zone', sortOrder: 50, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'zone-a5', warehouseId: 'wh-main', code: 'A5', name: 'A5 Zone', sortOrder: 60, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'zone-a6', warehouseId: 'wh-main', code: 'A6', name: 'A6 Zone', sortOrder: 70, createdAt: SEED_NOW, updatedAt: SEED_NOW },
  { id: 'zone-dispatch', warehouseId: 'wh-main', code: 'DISPATCH', name: 'Dispatch / Driver Load', sortOrder: 90, createdAt: SEED_NOW, updatedAt: SEED_NOW }
];
