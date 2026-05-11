require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const EXTRACT_PROMPT = `
You are a data extraction assistant for a Malaysian logistics company.
Extract key fields from customer enquiries and return them as JSON.

CRITICAL: Return ONLY raw JSON. No markdown, no backticks, no explanations.

You MUST use exactly these field names, no variations:
{
  "customer_name": "string",
  "contact_person": "string",
  "contact_number": "string",
  "delivery_location": "string",
  "delivery_date": "string",
  "items": [
    { "name": "string", "quantity": number }
  ],
  "missing_fields": ["array of missing field names"]
}

If a field is not found, set it to null and add it to missing_fields.

EXAMPLES:

Example 1:
Input: "Hi, Syarikat ABC needs 100 boxes of A4 paper sent to Petaling Jaya by next Friday. Call Ah Keong at 016-7654321."
Output:
{
  "customer_name": "Syarikat ABC",
  "contact_person": "Ah Keong",
  "contact_number": "016-7654321",
  "delivery_location": "Petaling Jaya",
  "delivery_date": "next Friday",
  "items": [{ "name": "A4 paper", "quantity": 100 }],
  "missing_fields": []
}

Example 2:
Input: "urgent need 50 units forklift battery for our Klang factory, Tan 011-2233445"
Output:
{
  "customer_name": null,
  "contact_person": "Tan",
  "contact_number": "011-2233445",
  "delivery_location": "Klang",
  "delivery_date": null,
  "items": [{ "name": "forklift battery", "quantity": 50 }],
  "missing_fields": ["customer_name", "delivery_date"]
}
`;

const fakeEnquiry = `
boss hailat dy, customer rush us juz nwo, they want 500 手套 and helmet 200, 发送 shah alam warehouse by 31stmay to 012-3456789. By Maju Trading 
`;

function cleanJSON(raw) {
  return raw
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
}

async function main() {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: EXTRACT_PROMPT,
    messages: [
      { role: 'user', content: fakeEnquiry }
    ]
  });

  const rawResponse = message.content[0].text;
  console.log('--- RAW RESPONSE ---');
  console.log(rawResponse);

  const cleaned = cleanJSON(rawResponse);
  const parsed = JSON.parse(cleaned);

  console.log('--- PARSED JSON ---');
  console.log(parsed);

  console.log('--- ACCESSING INDIVIDUAL FIELDS ---');
  console.log('Customer:', parsed.customer_name);
  console.log('Items ordered:', parsed.items.length);
  console.log('First item:', parsed.items[0].name, '-', parsed.items[0].quantity, 'units');
  console.log('Missing fields:', parsed.missing_fields);
}

main();