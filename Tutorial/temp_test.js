require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

async function testTemperature(temp) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 20,
    temperature: temp,
    messages: [
      { role: 'user', content: 'Describe your role as a logistics assistant in one sentence.' }
    ]
  });
  return response.content[0].text;
}

async function main() {
  console.log('=== TEMPERATURE 0 (run 3 times) ===');
  for (let i = 1; i <= 3; i++) {
    const result = await testTemperature(0);
    console.log(`Run ${i}:`, result, '\n');
  }
}

main();
