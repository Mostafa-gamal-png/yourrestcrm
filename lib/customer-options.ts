/** «تصنيف العميل» (data.customerType; labelled «نوع العميل» before this update): the classifications supplied by Yourrest offered when a
 *  customer is created or edited. Saved Arabic values stay stable. «خدمات» is no longer offered (the owner, 2026-11-10): a customer
 *  already classified so keeps it, shown as it is, and its own form still offers it (`choicesWithCurrent`) until another one is chosen. */
export const customerTypes = ['دوليون', 'مميزون', 'جملة', 'قطاعي', 'تجاري'] as const;
/** Classifications saved before that are no longer offered to anyone (kept for the record; nothing refuses them on a stored customer). */
export const retiredCustomerTypes = ['خدمات'] as const;
/** «نوع العميل» (data.customerKind, the owner, 2026-11-10): optional, one of these or empty; checked on the server (lib/crm.ts). */
export const customerKinds = ['مصنع', 'مؤسسة', 'شركة', 'محل تجاري'] as const;
export const customerStatuses = ['نشط', 'نصف نشط', 'خامل'] as const;
export const factoryCategories = ['خرسانة وبلوك', 'بلوك', 'خرسانة'] as const;
/** Whether a value is empty or one of the «نوع العميل» choices (the server's rule). */
export const isCustomerKind = (value: unknown) => value === '' || customerKinds.some(kind => kind === value);
/** The choices a customer's form offers for a field: the offered ones, then the customer's own stored value when it is no longer among
 *  them (a retired classification, an imported free text), so an unrelated edit never wipes it. */
export function choicesWithCurrent(choices: readonly string[], current: unknown): string[] {
  const value = typeof current === 'string' ? current : '';
  return value && !choices.includes(value) ? [...choices, value] : [...choices];
}
