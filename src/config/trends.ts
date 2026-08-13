/**
 * Trends page — available in local/dev builds only.
 * Production builds hide nav + redirect `/trends` so it never ships to users.
 */
export const TRENDS_ENABLED = !import.meta.env.PROD;
