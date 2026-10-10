import type { Row } from './crm';

/** Presentation search only: never changes the saved customer identity or location. */
export function normalizeMapSearch(value: string): string {
    return value.normalize('NFKD')
        .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
        .replace(/\p{M}/gu, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function text(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? normalizeMapSearch(String(value)) : '';
}

function phoneVariants(value: unknown): string[] {
    const digits = text(value).replace(/\D/g, '');
    if (!digits) return [];
    // Only normalize a complete Saudi mobile number; do not guess a country for other numbers.
    const national = digits.replace(/^(?:00966|966)(?=5\d{8}$)/, '0');
    const international = /^05\d{8}$/.test(national) ? '966' + national.slice(1) : digits;
    return Array.from(new Set([digits, national, international]));
}

/** One insertion, deletion, substitution, or adjacent transposition. */
function oneNameEdit(a: string, b: string): boolean {
    if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
    if (!/^\p{L}+$/u.test(a) || !/^\p{L}+$/u.test(b)) return false;
    if (a.length === b.length) {
        const differences: number[] = [];
        for (let index = 0; index < a.length; index++) {
            if (a[index] !== b[index]) differences.push(index);
            if (differences.length > 2) return false;
        }
        if (differences.length === 1) return true;
        if (differences.length !== 2) return false;
        const [first, second] = differences;
        return second === first + 1 && a[first] === b[second] && a[second] === b[first];
    }
    const shorter = a.length < b.length ? a : b, longer = a.length < b.length ? b : a;
    let shortIndex = 0, longIndex = 0, skipped = false;
    while (shortIndex < shorter.length && longIndex < longer.length) {
        if (shorter[shortIndex] === longer[longIndex]) { shortIndex++; longIndex++; }
        else { if (skipped) return false; skipped = true; longIndex++; }
    }
    return true;
}

type RankedCustomer = { row: Row; rank: number; field: number; order: number };

/**
 * Search only the supplied, already-authorized customers. The original rows are
 * returned unchanged; callers retain control of filtering, selection, and map movement.
 */
export function searchMapCustomers(customers: Row[], query: string, limit = 8): Row[] {
    const normalized = normalizeMapSearch(query), count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 8;
    if (!normalized || !count) return [];
    const terms = normalized.split(' ');
    const numericQuery = /^\d[\d ]*$/.test(normalized) ? phoneVariants(normalized) : [];
    const ranked: RankedCustomer[] = [];

    for (let order = 0; order < customers.length; order++) {
        const row = customers[order];
        if (row.kind !== 'customer') continue;
        const data = row.data && typeof row.data === 'object' ? row.data : {};
        const name = text(data.name), codes = [text(data.internalCode), text(data.code)].filter(Boolean), code = codes.join(' ');
        const phones = [...phoneVariants(data.phone), ...phoneVariants(data.phone2)];
        const fields = [name, code, phones.join(' '), [text(data.contact), text(data.contact2)].filter(Boolean).join(' '), text(data.city), text(data.region), text(data.address), text(data.shortAddress)];
        const nonemptyFields = fields.filter(Boolean);
        if (!nonemptyFields.length) continue;
        const phoneExact = numericQuery.some(needle => phones.includes(needle));
        if (name === normalized || codes.includes(normalized) || phoneExact) {
            ranked.push({ row, rank: 0, field: name === normalized ? 0 : codes.includes(normalized) ? 1 : 2, order });
            continue;
        }
        const phonePrefix = numericQuery.some(needle => phones.some(phone => phone.startsWith(needle)));
        const phoneContains = numericQuery.some(needle => phones.some(phone => phone.includes(needle)));
        const words = nonemptyFields.flatMap(field => field.split(' '));
        const allPrefix = terms.every(term => words.some(word => word.startsWith(term)));
        const allContained = terms.every(term => nonemptyFields.some(field => field.includes(term)));
        if (allPrefix || phonePrefix || allContained || phoneContains) {
            const nameMatch = terms.every(term => name.includes(term));
            const codeMatch = terms.every(term => code.includes(term));
            const field = nameMatch ? 0 : codeMatch ? 1 : phoneContains ? 2 : fields.findIndex(value => value && terms.every(term => value.includes(term)));
            const fullPrefix = nonemptyFields.some(value => value.startsWith(normalized)) || phonePrefix;
            ranked.push({ row, rank: fullPrefix ? 1 : allPrefix ? 2 : 3, field: field < 0 ? fields.length : field, order });
            continue;
        }
        // Fuzzy matching applies to one factory-name word only. Codes, phones,
        // addresses, and short terms must still match literally.
        const nameWords = name.split(' ');
        let correctedTerms = 0;
        const fuzzy = terms.every(term => {
            if (nonemptyFields.some(field => field.includes(term))) return true;
            if (correctedTerms || !nameWords.some(word => oneNameEdit(term, word))) return false;
            correctedTerms++;
            return true;
        });
        if (fuzzy && correctedTerms === 1) ranked.push({ row, rank: 4, field: 0, order });
    }
    return ranked.sort((a, b) => a.rank - b.rank || a.field - b.field || a.order - b.order).slice(0, count).map(result => result.row);
}
