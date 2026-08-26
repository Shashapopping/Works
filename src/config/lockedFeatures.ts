/**
 * Features locked behind the current package / org entitlement.
 * Pages wrapped in <FeatureGate featureId="..."> show the unavailable overlay.
 */
export type LockedFeatureId = 'dispatch' | 'reports' | 'aria' | 'maintenance';

/** Feature IDs that are not part of the current package */
export const LOCKED_FEATURES: ReadonlySet<LockedFeatureId> = new Set([
  'dispatch',
  'aria',
]);

export function isFeatureLocked(featureId?: string): boolean {
  if (!featureId) return false;
  return LOCKED_FEATURES.has(featureId as LockedFeatureId);
}

/** @deprecated Prefer embedding locked items in the main Sidebar NAV */
export const UPCOMING_FEATURES = [
  { path: '/trips', label: 'Journey Management', featureId: 'dispatch' as LockedFeatureId },
  { path: '/trips/dispatch', label: 'Dispatch', featureId: 'dispatch' as LockedFeatureId },
  { path: '/aria', label: 'AI Insights', featureId: 'aria' as LockedFeatureId },
] as const;
