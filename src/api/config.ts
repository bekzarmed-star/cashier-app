/**
 * Cashier frontend API base URL.
 * - Local dev: http://127.0.0.1:4002
 * - Docker (nginx proxy): empty string → same-origin /api/...
 */
export const BMS_API_URL = import.meta.env.VITE_BMS_API_URL ?? 'http://127.0.0.1:4002';

export const USE_MOCK =
  (import.meta.env.VITE_USE_MOCK ?? 'true').toLowerCase() !== 'false';

export const HOSPITAL_NAME = 'Zarmed Pratiksha Hospital';
export const HOSPITAL_TAGLINE = 'Касса';
export const DEFAULT_CURRENCY = 'UZS';
