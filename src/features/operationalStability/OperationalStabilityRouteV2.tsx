/**
 * Compatibility entry point retained for historical imports.
 *
 * Stability workspaces now execute inside UnifiedOperationalRoutes, which is
 * hosted by the shared OperationalSessionProvider and OperationalAppShell.
 * Forwarding this legacy module prevents a second auth/profile/navigation root
 * from being reintroduced by an old import.
 */
export { default } from '@/features/operationalRoutes/UnifiedOperationalRoutes';
