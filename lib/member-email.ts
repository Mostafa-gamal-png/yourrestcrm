/** Invisible text-direction formatting and zero-width characters a paste from an Arabic message brings with an email. */
export const invisibleEmailMarks = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/** The one spelling of a member's email: what the team form saves and what the sign-in page and the server look up. */
export function normalizeMemberEmail(value: string): string {
    return value.replace(invisibleEmailMarks, '').trim().toLowerCase();
}

export const memberEmailError = 'أدخل بريدًا إلكترونيًا صحيحًا، مثل name@yourrest.org';

/** A sign-in code as typed (lib/email-auth.ts and app/email-login.tsx): Arabic-Indic and Persian digits, which a phone's Arabic keyboard
 *  types, are read as the same digits (2026-11-23, found by the unit tests: the screen erased them and the server refused them). */
export function latinCodeDigits(value: string): string {
    return value.replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x6f0));
}
