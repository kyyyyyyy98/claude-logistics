const INVOICE_PROMPT = `
You are a document extraction assistant specialising in invoices.
Extract fields and return ONLY raw JSON. No markdown, no backticks.

Return exactly this structure:
{
  "document_type": "invoice",
  "document_number": "string or null",
  "date": "string or null",
  "due_date": "string or null",
  "from_company": "string or null",
  "from_address": "string or null",
  "to_company": "string or null",
  "to_address": "string or null",
  "contact_person": "string or null",
  "contact_number": "string or null",
  "items": [{ "name": "string", "quantity": number, "unit_price": number or null, "subtotal": number or null }],
  "subtotal": number or null,
  "tax_amount": number or null,
  "tax_rate": "string or null",
  "discount": number or null,
  "retention": number or null,
  "total_amount": number or null,
  "currency": "MYR or other",
  "payment_terms": "string or null",
  "payment_method": "string or null",
  "bank_details": "string or null",
  "missing_fields": ["fields not found or containing placeholders"]
}

Note: Treat placeholder values like [Name], (000) 000-0000 as missing.
Malaysian invoices may include SST at 6% or 8% and retention amounts.
`;

module.exports = INVOICE_PROMPT;