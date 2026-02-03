// Manual test script for URL validation
// Run with: npx tsx test-validator.ts

import { validateUrls } from './lib/url-validator';

async function runTests() {
  console.log('Testing URL Validator\n');

  // Test URLs with various status codes
  const testUrls = [
    'https://docs.anthropic.com/en/api/getting-started', // Valid (with redirect)
    'https://www.npmjs.com/package/react', // Valid
    'https://github.com/anthropics/claude-code', // Valid
    'https://example.com/definitely-does-not-exist-12345', // Real 404
    'https://github.com/this-repo-does-not-exist-xyz123', // 404
    'https://www.google.com', // Valid
  ];

  console.log(`Testing ${testUrls.length} URLs:\n`);
  testUrls.forEach((url, i) => console.log(`${i + 1}. ${url}`));
  console.log('\n' + '='.repeat(60) + '\n');

  const results = await validateUrls(testUrls);

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60) + '\n');

  results.forEach((result, i) => {
    const status = result.valid ? '✅ VALID' : '❌ BROKEN';
    console.log(`${i + 1}. ${status} - ${result.url}`);
    console.log(`   Status: ${result.status}`);
    if (result.finalUrl && result.finalUrl !== result.url) {
      console.log(`   Redirected to: ${result.finalUrl}`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    console.log();
  });

  const validCount = results.filter(r => r.valid).length;
  const brokenCount = results.filter(r => !r.valid).length;
  const redirectedCount = results.filter(r => r.finalUrl && r.finalUrl !== r.url).length;

  console.log('='.repeat(60));
  console.log('STATISTICS');
  console.log('='.repeat(60));
  console.log(`Total URLs checked: ${results.length}`);
  console.log(`Valid URLs: ${validCount}`);
  console.log(`Broken URLs: ${brokenCount}`);
  console.log(`Redirected URLs: ${redirectedCount}`);
  console.log();
}

runTests().catch(console.error);
