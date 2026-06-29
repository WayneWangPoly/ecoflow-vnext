export const ROLES = {
  owner: 'owner',
  warehouse: 'warehouse',
  picker: 'picker',
  driver: 'driver'
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  warehouse: 'Warehouse',
  picker: 'Picker',
  driver: 'Driver'
};
