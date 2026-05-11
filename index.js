require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const readline = require('readline');

const client = new Anthropic();

// ── PROMPTS ──────────────────────────────────────────

const EXTRACT_PROMPT = `
You are a data extraction assistant for a Malaysian logistics company.
Extract key fields from customer enquiries and return ONLY raw JSON.
No markdown, no backticks, no explanations. Just pure JSON.

You MUST use exactly these field names:
{
  "customer_name": "string or null",
  "contact_person": "string or null",
  "contact_number": "string or null",
  "delivery_location": "string or null",
  "delivery_date": "string or null",
  "items": [{ "name": "string", "quantity": number }],
  "missing_fields": ["array of field names that are missing"]
}

If items array is empty, add "items" to missing_fields.
If a field is not found, set it to null and add to missing_fields.

EXAMPLES:
Input: "Syarikat ABC needs 100 boxes A4 paper to PJ by Friday. Ah Keong 016-7654321."
Output:
{
  "customer_name": "Syarikat ABC",
  "contact_person": "Ah Keong",
  "contact_number": "016-7654321",
  "delivery_location": "Petaling Jaya",
  "delivery_date": "Friday",
  "items": [{ "name": "A4 paper", "quantity": 100 }],
  "missing_fields": []
}

Input: "urgent 50 forklift battery Klang factory, Tan 011-2233445"
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

Input: "boss urgent, Maju Trading nak order 500 gloves, hantar Shah Alam by 30 June, contact Ahmad 012-3456789"
Output:
{
  "customer_name": "Maju Trading",
  "contact_person": "Ahmad",
  "contact_number": "012-3456789",
  "delivery_location": "Shah Alam",
  "delivery_date": "30 June",
  "items": [{ "name": "gloves", "quantity": 500 }],
  "missing_fields": []
}

Input: "pls send 100 units cable wire to our Subang office tmr, call Encik Razif 019-8887776"
Output:
{
  "customer_name": null,
  "contact_person": "Encik Razif",
  "contact_number": "019-8887776",
  "delivery_location": "Subang",
  "delivery_date": "tomorrow",
  "items": [{ "name": "cable wire", "quantity": 100 }],
  "missing_fields": ["customer_name"]
}
`;

const CONVERSATION_PROMPT = `
You are a friendly logistics assistant for a Malaysian SME trading company.
Your job is to collect missing order details from customers naturally and conversationally.

Rules:
- Ask for only ONE missing field per message
- Be friendly, use natural language — not robotic
- Accept casual Malaysian English, Malay words, Chinese characters
- When asking for items, ask for both product name AND quantity together
- Keep responses short — one question only
- Do not repeat information the customer already gave
`;

// ── HELPERS ──────────────────────────────────────────

function cleanJSON(raw) {
  return raw
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
}

function generateQuotation(data) {
  const itemsText = data.items.map((item, i) =>
    `  ${i + 1}. ${item.name} — ${item.quantity} units @ [PRICE] = [AMOUNT]`
  ).join('\n');

  const ref = `QT-${Date.now()}`;
  const date = new Date().toLocaleDateString('en-MY');

  return `
╔══════════════════════════════════════════╗
           QUOTATION DRAFT
╚══════════════════════════════════════════╝

  Ref:     ${ref}
  Date:    ${date}

  To:      ${data.customer_name}
  Attn:    ${data.contact_person}
  Phone:   ${data.contact_number}

──────────────────────────────────────────
  ITEMS
──────────────────────────────────────────
${itemsText}

──────────────────────────────────────────
  Delivery to:   ${data.delivery_location}
  Delivery by:   ${data.delivery_date}
  Payment terms: 30 days net
  Valid for:     7 days
──────────────────────────────────────────

  ⚠️  Replace [PRICE] and [AMOUNT] before sending.
`;
}

// ── CORE FUNCTIONS ───────────────────────────────────

async function extractFields(text) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    temperature: 0,
    system: EXTRACT_PROMPT,
    messages: [{ role: 'user', content: text }]
  });

  const cleaned = cleanJSON(response.content[0].text);
  return JSON.parse(cleaned);
}

async function getNextQuestion(conversationHistory, missingFields) {
  const prompt = `
The customer is placing a logistics order. 
These fields are still missing: ${missingFields.join(', ')}.
Ask for the first missing field only. Be friendly and brief.
`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 256,
    temperature: 0.3,
    system: CONVERSATION_PROMPT,
    messages: [
      ...conversationHistory,
      { role: 'user', content: prompt }
    ]
  });

  return response.content[0].text;
}

function mergeData(existing, update) {
  const merged = { ...existing };

  for (const key of Object.keys(update)) {
    if (key === 'missing_fields') continue;
    if (key === 'items') {
      if (update.items && update.items.length > 0) {
        merged.items = update.items;
      }
    } else {
      if (update[key] !== null) {
        merged[key] = update[key];
      }
    }
  }

  // Recalculate missing fields
  merged.missing_fields = [];
  const required = ['customer_name', 'contact_person', 'contact_number', 'delivery_location', 'delivery_date'];
  for (const field of required) {
    if (!merged[field]) merged.missing_fields.push(field);
  }
  if (!merged.items || merged.items.length === 0) {
    merged.missing_fields.push('items');
  }

  return merged;
}

// ── MAIN LOOP ─────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('      🇲🇾  Logistics Assistant  🇲🇾');
  console.log('╚══════════════════════════════════════════╝');
  console.log('Send your enquiry. Type "exit" to quit.\n');

  const conversationHistory = [];
  let orderData = {
    customer_name: null,
    contact_person: null,
    contact_number: null,
    delivery_location: null,
    delivery_date: null,
    items: [],
    missing_fields: ['customer_name', 'contact_person', 'contact_number', 'delivery_location', 'delivery_date', 'items']
  };

  // First message
  const firstInput = await ask('You: ');
  if (firstInput.toLowerCase() === 'exit') { rl.close(); return; }

  conversationHistory.push({ role: 'user', content: firstInput });

  // Extract whatever we can from the first message
  try {
    const extracted = await extractFields(firstInput);
    orderData = mergeData(orderData, extracted);
  } catch (e) {
    // If extraction fails, treat everything as missing
  }

  // Conversation loop
  while (orderData.missing_fields.length > 0) {
    const question = await getNextQuestion(conversationHistory, orderData.missing_fields);
    console.log('\nClaude:', question, '\n');
    conversationHistory.push({ role: 'assistant', content: question });

    const userInput = await ask('You: ');
    if (userInput.toLowerCase() === 'exit') { rl.close(); return; }
    conversationHistory.push({ role: 'user', content: userInput });

    // Extract from the new input
    try {
      const extracted = await extractFields(userInput);
      orderData = mergeData(orderData, extracted);
    } catch (e) {
      // Keep asking if extraction fails
    }
  }

  // All fields collected
  console.log('\nClaude: Perfect, I have everything. Generating your quotation now...\n');
  console.log(generateQuotation(orderData));

  rl.close();
}

main();