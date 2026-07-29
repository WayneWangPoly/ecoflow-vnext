export type IntelligenceFeatureFlags = {
  overlay_navigation_v1: boolean;
};

function parseBooleanFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.trim().toLowerCase());
}

export function resolveIntelligenceFeatureFlags(
  source: Record<string, unknown> = {},
): IntelligenceFeatureFlags {
  return {
    overlay_navigation_v1: parseBooleanFlag(source.VITE_OVERLAY_NAVIGATION_V1),
  };
}

const viteEnvironment = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env ?? {};

export const intelligenceFeatureFlags = resolveIntelligenceFeatureFlags(viteEnvironment);
