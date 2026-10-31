/** Invisible text-direction formatting and zero-width characters a paste from an Arabic message brings with an email. */
export const invisibleEmailMarks = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/** The one spelling of a member's email: what the team form saves and what the sign-in page and the server look up. */
export function normalizeMemberEmail(value: string): string {
    return value.replace(invisibleEmailMarks, '').trim().toLowerCase();
}

export const memberEmailError = 'أدخل بريدًا إلكترونيًا صحيحًا، مثل name@yourrest.org';
