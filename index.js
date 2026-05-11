require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const readline = require('readline');

// ── Import prompts from separate files ──
const EXTRACT_PROMPT = require('./prompts/extract');
const QUOTE_PROMPT = require('./prompts/quote');
const CONVERSATION_PROMPT = require('./prompts/conversation');

const client = new Anthropic();

// ── Strips markdown code fences from Claude's response ──
function cleanJSON(raw) {
  return raw
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
}

// ── Extracts structured fields from any customer enquiry text ──
// Returns parsed JSON or throws if Claude returns invalid JSON
async function extractEnquiry(text) {
  console.log('\n[Step 1] Extracting fields from enquiry...');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    temperature: 0,
    system: EXTRACT_PROMPT,
    messages: [{ role: 'user', content: text }]
  });

  const cleaned = cleanJSON(response.content[0].text);

  try {
    const parsed = JSON.parse(cleaned);
    console.log('[Step 1] Extracted:', JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (e) {
    throw new Error('Failed to parse JSON from Claude: ' + cleaned);
  }
}

// ── Asks Claude what the next follow-up question should be ──
// Based on conversation history and which fields are still missing
async function askForMissing(conversationHistory, missingFields) {
  console.log('\n[Step 2] Missing fields:', missingFields.join(', '));

  const prompt = `
The customer is placing a logistics order.
These fields are still missing: ${missingFields.join(', ')}.
Ask for the FIRST missing field only. Be friendly and brief.
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

// ── Generates a formatted quotation string from complete order data ──
function generateQuotation(fields) {
  console.log('\n[Step 3] Generating quotation...');

  const itemsText = fields.items.map((item, i) =>
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

  To:      ${fields.customer_name}
  Attn:    ${fields.contact_person}
  Phone:   ${fields.contact_number}

──────────────────────────────────────────
  ITEMS
──────────────────────────────────────────
${itemsText}

──────────────────────────────────────────
  Delivery to:   ${fields.delivery_location}
  Delivery by:   ${fields.delivery_date}
  Payment terms: 30 days net
  Valid for:     7 days
──────────────────────────────────────────

  ⚠️  Replace [PRICE] and [AMOUNT] before sending.
`;
}

// ── Merges newly extracted data into existing order data ──
// Only overwrites null fields — never erases what's already collected
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

  // Recalculate missing fields after merge
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

// ── Main conversation loop ──
async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (prompt) => new Promise(resolve => {
    process.stdout.write(prompt);
    rl.once('line', resolve);
  });

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('      🇲🇾  Logistics Assistant  🇲🇾');
  console.log('╚══════════════════════════════════════════╝');
  console.log('Send your enquiry. Type "exit" to quit.\n');

  // Initialise empty order data
  let orderData = {
    customer_name: null,
    contact_person: null,
    contact_number: null,
    delivery_location: null,
    delivery_date: null,
    items: [],
    missing_fields: ['customer_name', 'contact_person', 'contact_number', 'delivery_location', 'delivery_date', 'items']
  };

  const conversationHistory = [];

  // Get first message from customer
  const firstInput = await ask('You: ');
  if (firstInput.toLowerCase() === 'exit') { rl.close(); return; }
  conversationHistory.push({ role: 'user', content: firstInput });

  // Extract whatever fields we can from the first message
  try {
    const extracted = await extractEnquiry(firstInput);
    orderData = mergeData(orderData, extracted);
  } catch (e) {
    console.log('[Warning] Initial extraction failed — treating all fields as missing');
  }

  // Keep asking until all fields are collected
  while (orderData.missing_fields.length > 0) {
    const question = await askForMissing(conversationHistory, orderData.missing_fields);
    console.log('\nClaude:', question, '\n');
    conversationHistory.push({ role: 'assistant', content: question });

    const userInput = await ask('You: ');
    if (userInput.toLowerCase() === 'exit') { rl.close(); return; }
    conversationHistory.push({ role: 'user', content: userInput });

    // Extract from the follow-up response
    try {
      const extracted = await extractEnquiry(userInput);
      orderData = mergeData(orderData, extracted);
    } catch (e) {
      console.log('[Warning] Could not extract from this response — trying again');
    }
  }

  // All fields collected — generate quotation
  console.log('\nClaude: Perfect, I have everything. Generating your quotation now...');
  console.log(generateQuotation(orderData));

  rl.close();
}

main();