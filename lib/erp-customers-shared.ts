/** What the «استيراد من ERP» screen and the server share, kept apart from lib/erp-customers.ts so the screen carries no matcher code.
 * ERP_ADD_CUSTOMER is the choice «عميل جديد» (add the ERP row as a new CRM customer): a value that can never be a record id (ids are
 * letters, digits and dashes; the server also refuses it if a record ever had it), accepted only on a `new` or `similar` row. */
export const ERP_ADD_CUSTOMER='+new';
/** New customers one apply may add; above it the apply is refused with a message, and the user leaves the rest («سيبه») for another time. */
export const ERP_CUSTOMERS_MAX_ADDS=2000;
