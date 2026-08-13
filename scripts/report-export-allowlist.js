/**
 * HBM report export allowlist — download + email only for these email domains.
 */
export const REPORT_EXPORT_ALLOWED_DOMAINS = [
  'ng.huaxin.com',
  'bestpracticesltd.com',
];

export function normalizeReportEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function emailDomain(email) {
  const n = normalizeReportEmail(email);
  const at = n.lastIndexOf('@');
  if (at < 0) return '';
  return n.slice(at + 1);
}

export function isReportExportAllowed(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  return REPORT_EXPORT_ALLOWED_DOMAINS.some(
    allowed => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}
