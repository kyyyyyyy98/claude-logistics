const { extractFromDocument } = require('./lib/documentProcessor');

async function main() {
  const files = [
    './invoice.pdf',
    './purchase_order.pdf',
    './delivery_order.pdf',
    './test.txt',
    './nonexistent.pdf'
  ];

  const results = [];

  for (const file of files) {
    console.log(`\nProcessing: ${file}`);
    const result = await extractFromDocument(file);

    if (result.success) {
      const d = result.data;
      console.log(`✓ ${d.document_type} — ${d.document_number || 'no number'} — ${d.missing_fields.length} missing fields`);
      results.push({ file, result });
    } else {
      console.log(`✗ ${result.error.type}: ${result.error.message}`);
      results.push({ file, result });
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  results.forEach(({ file, result }) => {
    if (result.success) {
      console.log(`✓ ${file} — ${result.data.document_type} — ${result.data.missing_fields.length} missing`);
    } else {
      console.log(`✗ ${file} — ${result.error.type}`);
    }
  });
}

main();