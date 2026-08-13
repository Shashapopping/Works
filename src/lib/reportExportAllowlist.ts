/** HBM report export allowlist — must match scripts/report-export-allowlist.js */
export const REPORT_EXPORT_ALLOWED_DOMAINS = [
  'ng.huaxin.com',
  'bestpracticesltd.com',
] as const;

export function normalizeReportEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}

export function emailDomain(email: string | null | undefined): string {
  const n = normalizeReportEmail(email);
  const at = n.lastIndexOf('@');
  if (at < 0) return '';
  return n.slice(at + 1);
}

export function isReportExportAllowed(email: string | null | undefined): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return REPORT_EXPORT_ALLOWED_DOMAINS.some(
    allowed => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}
