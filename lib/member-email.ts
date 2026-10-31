/** Remove invisible text-direction formatting and zero-width characters copied with a login email. */
export function normalizeMemberEmail(value: string): string {
    return value.replace(/[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '').trim().toLowerCase();
}

export const memberEmailError = 'أدخل بريدًا إلكترونيًا صحيحًا، مثل name@yourrest.org';
