const STORAGE_PREFIX = 'hbm-offline-snapshot:';

export interface OfflineSnapshot {
  assetIds: string[];
  sentAt: string;
}

export function diffRepeatOffenders(
  previousAssetIds: Iterable<string>,
  currentAssetIds: Iterable<string>,
): Set<string> {
  const prev = new Set(previousAssetIds);
  const repeat = new Set<string>();
  for (const id of currentAssetIds) {
    if (prev.has(id)) repeat.add(id);
  }
  return repeat;
}

export function loadOfflineSnapshot(scopeKey: string): OfflineSnapshot | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${scopeKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineSnapshot;
    if (!Array.isArray(parsed.assetIds) || typeof parsed.sentAt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOfflineSnapshot(scopeKey: string, assetIds: string[]): void {
  const snapshot: OfflineSnapshot = {
    assetIds,
    sentAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${scopeKey}`, JSON.stringify(snapshot));
  } catch {
    // ignore quota errors
  }
}

export function repeatOffenderIdsFromSnapshot(
  scopeKey: string,
  currentAssetIds: string[],
): Set<string> {
  const prev = loadOfflineSnapshot(scopeKey);
  if (!prev) return new Set();
  return diffRepeatOffenders(prev.assetIds, currentAssetIds);
}
