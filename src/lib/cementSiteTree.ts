/**
 * Cement segment site hierarchy — used by the global Sites dropdown (SiteSelector)
 * to group the flat MiX zone list into the real HBM Cement distribution structure:
 * HBM East / HBM North / HBM West, with West broken down into DD West's transporters,
 * MDD, Spot Hire West and West Bulk Tanker.
 *
 * Verified against a live `public/data.json` snapshot (11 Aug 2026):
 *  - Region-level nodes (HBM East/North/West, DD West, MDD, Spot Hire, West Bulk
 *    Tanker, IPI Installation Assets) match against the vehicle `zone` field —
 *    same field the flat "Other sites" list already keys off.
 *  - Individual transporter leaves (Truluck, Shiwatech, Sagamu Global, …) do NOT
 *    have their own zone — they all share zone "DD WEST". They only appear on the
 *    granular `site` field (exactly how the Fleet/Assets page's grouped view already
 *    breaks vehicles down: major group → site). So leaf nodes match on `site`.
 */

export type SiteMatchField = 'zone' | 'site';

export interface SiteTreeNode {
  key: string;
  label: string;
  /** Matches a real MiX value directly against this node (optional for pure branch nodes). */
  match?: RegExp;
  /** Which vehicle field `match` is tested against. Defaults to 'zone'. */
  field?: SiteMatchField;
  children?: SiteTreeNode[];
}

export interface SiteOption { key: string; label: string; count: number }

// Confirmed live under zone "DD WEST" via `site` field.
const ddWestChildren: SiteTreeNode[] = [
  { key: 'defrost', label: 'Defrost', match: /DEFROST/i, field: 'site' },
  { key: 'deomat', label: 'Deomat', match: /DEOMAT/i, field: 'site' },
  { key: 'ebony', label: 'Ebony', match: /EBONY/i, field: 'site' },
  { key: 'ewecoop', label: 'Ewecoop', match: /EWECOOP/i, field: 'site' },
  { key: 'geoman-praise', label: 'Geoman Praise', match: /GEOMAN\s*PRAISE/i, field: 'site' },
  { key: 'hbm-transport', label: 'HBM Transport', match: /^HBM\s*TRANSPORT$/i, field: 'site' },
  { key: 'hst', label: 'HST', match: /^HST$/i, field: 'site' },
  { key: 'jbc-west', label: 'JBC West', match: /JBC\s*WEST/i, field: 'site' },
  { key: 'joza-west', label: 'JOZA West', match: /^JOZA(\s*WEST)?$/i, field: 'site' },
  { key: 'kaysky', label: 'Kaysky Nigeria Limited', match: /KAYSKY/i, field: 'site' },
  { key: 'abdlas', label: 'Abdlas', match: /^ABDLAS$/i, field: 'site' },
  { key: 'big-multiquest', label: 'B.I.G Multiquest', match: /B\.?\s*I\.?\s*G\s*MULTIQUEST/i, field: 'site' },
  { key: 'bhn-ewekoro', label: 'BHN Ewekoro', match: /BHN\s*EWEKORO/i, field: 'site' },
  { key: 'charterbridge', label: 'Charterbridge Ventures Logistics Ltd', match: /CHARTERBRIDGE\s*VENTURES/i, field: 'site' },
  { key: 'rem-bam', label: 'Rem Bam', match: /^REM\s*BAM$/i, field: 'site' },
  { key: 'remo-commercial', label: 'Remo Commercial', match: /REMO\s*COMMERCIAL/i, field: 'site' },
  { key: 'sagamu-global', label: 'Sagamu Global', match: /SAGAMU\s*GLOBAL/i, field: 'site' },
  { key: 'shiwatech', label: 'Shiwatech', match: /SHIWATECH/i, field: 'site' },
  { key: 'truluck', label: 'Truluck', match: /^TRULUCK$/i, field: 'site' },
  { key: 'tsl-west', label: 'TSL West', match: /TSL\s*WEST/i, field: 'site' },
];

const hbmWestChildren: SiteTreeNode[] = [
  { key: 'dd-west', label: 'DD West', match: /^DD\s*WEST$/i, field: 'zone', children: ddWestChildren },
  { key: 'mdd', label: 'MDD', match: /\bMDD\b/i, field: 'zone' },
  { key: 'spot-hire-west', label: 'Spot Hire West', match: /^SPOT\s*HIRE$/i, field: 'zone' },
  { key: 'west-bulk-tanker', label: 'West Bulk Tanker', match: /WEST\s*BULK\s*TANKER/i, field: 'zone' },
];

export const CEMENT_SITE_TREE: SiteTreeNode = {
  key: 'cement',
  label: 'Cement',
  children: [
    // "DD" (no suffix) is the East-side twin of "DD WEST" — same transporter names
    // (Truluck East Ops, HST East Op, Kaysky East Operation…) operating East corridors.
    { key: 'hbm-east', label: 'HBM East', match: /(HBM|LH)\s*-?\s*EAST\b|EAST\s*INBOUND|^DD$/i, field: 'zone' },
    { key: 'hbm-north', label: 'HBM North', match: /(HBM|LH)\s*-?\s*NORTH\b|NORTH\s*INBOUND|NORTH\s*SPOT\s*HIRE/i, field: 'zone' },
    { key: 'hbm-west', label: 'HBM West', match: /(HBM|LH)\s*-?\s*WEST\b|WEST\s*INBOUND/i, field: 'zone', children: hbmWestChildren },
    { key: 'ipi-installation-assets', label: 'IPI Installation Assets', match: /IPI\s*INSTALL/i, field: 'zone' },
    { key: 'mix-vision-pilot-cement', label: 'Mix Vision Pilot Cement', match: /PILOT\s*CEMENT|MIX\s*VISION.*CEMENT/i, field: 'zone' },
  ],
};

function fieldOptions(node: SiteTreeNode, zoneOptions: SiteOption[], siteOptions: SiteOption[]): SiteOption[] {
  return node.field === 'site' ? siteOptions : zoneOptions;
}

/** Real option keys that match this node directly (not descendants). */
export function directMatchKeys(node: SiteTreeNode, zoneOptions: SiteOption[], siteOptions: SiteOption[]): string[] {
  if (!node.match) return [];
  return fieldOptions(node, zoneOptions, siteOptions).filter(o => node.match!.test(o.key)).map(o => o.key);
}

/** Real option keys matched by this node OR any of its descendants (deduped, across both fields). */
export function allMatchKeys(node: SiteTreeNode, zoneOptions: SiteOption[], siteOptions: SiteOption[]): string[] {
  const set = new Set<string>(directMatchKeys(node, zoneOptions, siteOptions));
  for (const child of node.children || []) {
    for (const k of allMatchKeys(child, zoneOptions, siteOptions)) set.add(k);
  }
  return Array.from(set);
}

/** Sum of vehicle counts across every real option (zone or site) matched by this node or its descendants. */
export function nodeCount(node: SiteTreeNode, zoneOptions: SiteOption[], siteOptions: SiteOption[]): number {
  const keys = new Set(directMatchKeys(node, zoneOptions, siteOptions));
  const opts = fieldOptions(node, zoneOptions, siteOptions);
  let total = opts.filter(o => keys.has(o.key)).reduce((s, o) => s + o.count, 0);
  for (const child of node.children || []) total += nodeCount(child, zoneOptions, siteOptions);
  return total;
}

/** True if the node label or any descendant label matches the search query. */
export function nodeMatchesQuery(node: SiteTreeNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (node.label.toLowerCase().includes(q)) return true;
  return (node.children || []).some(c => nodeMatchesQuery(c, q));
}
