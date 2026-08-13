/** Russian UI labels */

export const ROLE_RU: Record<string, string> = {
  cashier: 'кассир',
  supervisor: 'супервайзер',
  admin: 'админ',
};

export const PAYMENT_RU: Record<string, string> = {
  cash: 'наличные',
  card: 'карта',
  transfer: 'перевод',
  insurance: 'страховка',
  mixed: 'смешанная',
};

export function roleRu(role?: string) {
  if (!role) return '';
  return ROLE_RU[role] || role;
}

export function paymentRu(method?: string) {
  if (!method) return '';
  return PAYMENT_RU[method] || method;
}
