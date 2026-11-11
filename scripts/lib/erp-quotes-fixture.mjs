// Synthetic ERP quotations reports for the tests (tests/erp-quotes*.mjs): the ERP's 197 column names in its order, one row per quotation
// line, written as the ERP writes its «.xls» (an HTML table in UTF-16LE with a byte-order mark, <TABLE><TR><TD>…, closed by a second
// «<TABLE>» as the ERP closes it) or as an .xlsx with the same columns. Made-up customers, items and prices only: never the owner's file.
import {zipSync, strToU8} from 'fflate';

export const ERP_QUOTE_COLUMNS = ["ID", "Transaction_ID", "Product_ID", "Description", "Price", "Qty", "Disc_rate", "Total", "VAT", "Branch_ID", "CreatedBy", "CreatedOn", "ModifiedBy", "ModifiedOn", "IsDeleted", "Account_ID", "CC_ID", "Barcode", "Item_Name", "Cat_Name", "Trans_Type_ID", "IsDeletedM", "IsDeletedItem_Unit", "CustomerID", "Date1", "Expiration_Date", "Due_Date", "Delivery_Date", "Inventory_ID", "Emp_ID", "Code", "Unit_ID", "Discount_Amount", "CustomerName", "CustomerCode", "Emp_Code", "Emp_name", "RecipientName", "Address", "Phone", "Waybill", "Discount_Amount_M", "Subtotal", "Discount_Rate_M", "Payment_Terms_Name", "Payment_Terms", "Document_Note", "Delivery_Term", "Facility_ID", "Amount_Paid", "Amount_Remaining", "UnitName", "PO_Number", "Purchase_Price", "VAT_Amount", "VAT_AmountM", "Cus_VAT_Number", "Fac_VAT_Number", "Amount_Cost", "Unit_Cost", "VAT_ID", "Expr3", "Profit", "Transaction_Type_name", "Trans_Type_Code", "Trans_Type_Name", "Trans_Type_Name2", "CustomerName2", "No", "NewTotal", "Project_Code", "Equivalent", "POS_ID", "NewSubtotal", "Due_Period_Days", "Safety_Period_Days", "Safety_Date", "Type_ID", "Type_Name", "Sales_Area_Name", "Payment_Terms_ID", "Refrance_ID", "Batch_ID", "Batch_Code", "Supplier_Code", "Supplier_Name", "Supplier_ID", "Sal_T_ID", "Sal_P_ID", "Amount_Write", "Amount_WriteE", "Has_Reservation", "Mobile_Cus", "InventoryName", "Inventory_D_ID", "Inventory_D_Name", "Cash_Amount", "Bank_Amount", "Net_Total_Write", "Item_Name2", "Inventory_D_Name2", "Customer_Address", "Customer_ID_No", "Customer_Email", "Fac_ID_Number", "Payment_Terms2", "BRA_NAME", "Mobile", "CostCenter_Name", "CostCenter_Code", "CostCenter_Name2", "City_Name", "City_Code", "City_ID", "Manager_ID", "Manager_Code", "Manager_Name", "Currency_ID", "Exchange_Rate", "Item_Type", "EquivalentUnit", "UnitNameDefault", "BRA_MOBILE", "BRA_ADDRESS", "Additional_Amount", "Item_Code", "VatResonID", "Group_ID", "Facility_Address", "Account_Deferred_income", "Separate_Account_Contractor", "Account_Members", "IdentitiType", "Facilities_CountryCode", "Facilities_DistrictName", "PostalCode", "Facilities_BuildingNumber", "AdditionalStreetAddress", "Facilities_StreetName", "Facilities_RegionName", "POBox", "ZipCode", "Customer_Mobile", "StreetName", "BuildingNumber", "DistrictName", "RegionName", "Collector_ID", "CountryCode", "InvoiceTypeName2", "InvoiceTypeName", "Title", "SO_Code", "Item_Model", "Manufacturer_ID", "Manufacturer_Name", "Manufacturer_Name2", "Sku", "Cat_ID", "Parent_ID", "Parent_Parent_ID", "Project_Name", "BAR_Phone", "BAR_Email", "Project_Name2", "BRA_NAME2", "CurrencyName", "CurrencyName2", "Quotation_Code", "IsClosed", "ClosedNote", "CurrencyCode", "DiscounLocalCurrency", "TotalLocalCurrency", "ProfitLocalCurrency", "Emp_Name2", "DCostCenter_Code", "DCostCenter_Name", "DCostCenter_Name2", "InvoiceType", "UnitName2", "Cat_Name2", "UUID", "ImgItem", "Note", "App_ID", "Project_ID", "Emp_ID2", "Marketing_Person", "Emp_Code2", "Marketing_Person2", "Account_Discount", "Country_ID", "Item_Origin", "Hours_Count", "Minutes_Count", "Customer_VAT_Enable"];

const fixed = value => Number(value).toFixed(6);
/** One quotation: its lines carry the header fields the ERP repeats on every line. Figures are computed as the ERP computes them. */
export function quotation({code, date = '2026/11/03', expiration = '2026/11/18', customerCode = '101', customerName = 'مصنع تجريبي', empCode = '7001', empName = 'موظف تجريبي', vat = 15, documentDiscount = 0, payment = 'دفعة مقدمة 50 % والباقي عند التسليم', delivery = '30 يوم', note = '', type = 'Qut', lines}) {
  const totals = lines.map(line => Math.round((line.qty * line.price - (line.discount || 0)) * 100) / 100);
  const subtotal = Math.round((totals.reduce((s, v) => s + v, 0) - documentDiscount) * 100) / 100;
  const vatM = Math.round(subtotal * vat) / 100, grand = Math.round((subtotal + vatM) * 100) / 100;
  return lines.map((line, index) => {
    const total = totals[index], lineVat = Math.round(total * vat) / 100;
    const values = {
      ID: String(9000 + index), Transaction_ID: String(500000 + Number(String(code).replace(/\D/g, '') || 0)), Description: line.description || '', Price: fixed(line.price), Qty: Number(line.qty).toFixed(4),
      Disc_rate: fixed(0), Total: fixed(total), VAT: fixed(vat), IsDeleted: line.deleted ? 'True' : 'False', Item_Name: line.name, Item_Name2: line.nameEn || '', Cat_Name: line.category || 'Normal Mold /قوالب',
      CustomerID: '1', Date1: date, Expiration_Date: expiration, Due_Date: '', Code: code, Discount_Amount: fixed(line.discount || 0), CustomerName: customerName, CustomerCode: customerCode,
      Emp_Code: empCode, Emp_name: empName, Discount_Amount_M: fixed(documentDiscount), Subtotal: fixed(subtotal), Discount_Rate_M: fixed(0), Payment_Terms_Name: payment, Document_Note: note,
      Delivery_Term: delivery, UnitName: line.unit ?? 'حبة / PC', VAT_Amount: fixed(lineVat), VAT_AmountM: fixed(vatM), Transaction_Type_name: 'عرض اسعار', Trans_Type_Code: type, Trans_Type_Name: 'عرض سعر',
      Trans_Type_Name2: 'Quotation', No: String(code).replace(/\D/g, ''), NewTotal: fixed(total + lineVat), NewSubtotal: fixed(grand), Item_Code: line.code ?? '10010001', Barcode: line.code ?? '10010001',
      Exchange_Rate: '1.0000000000', CurrencyCode: 'SAR', IsClosed: 'False', Additional_Amount: fixed(0), ...(line.override || {}),
    };
    return ERP_QUOTE_COLUMNS.map(column => values[column] ?? '');
  });
}
const html = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** The ERP's «.xls»: an HTML table in UTF-16LE with a byte-order mark. */
export function erpQuotesXls(rows, {columns = ERP_QUOTE_COLUMNS, ending = '<TABLE>'} = {}) {
  const text = '<TABLE>' + [columns, ...rows].map(cells => '<TR>' + cells.map(cell => '<TD>' + html(cell) + '</TD>').join('') + '</TR>').join('') + ending;
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
/** The same columns saved as .xlsx (one sheet, inline strings). */
export function erpQuotesXlsx(rows, {columns = ERP_QUOTE_COLUMNS} = {}) {
  const cell = value => `<c t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${[columns, ...rows].map((cells, index) => `<row r="${index + 1}">${cells.map(cell).join('')}</row>`).join('')}</sheetData></worksheet>`),
  }));
}
