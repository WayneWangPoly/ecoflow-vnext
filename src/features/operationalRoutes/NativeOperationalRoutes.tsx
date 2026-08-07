/**
 * Compatibility entry point retained for historical imports.
 *
 * Production ownership moved to UnifiedOperationalRoutes under the shared
 * OperationalSessionProvider and OperationalAppShell in TRANSFORM-002.
 * Keeping this path as a forwarding module prevents a future import from
 * resurrecting the retired duplicate auth/profile/navigation root.
 */
export { default } from './UnifiedOperationalRoutes';
