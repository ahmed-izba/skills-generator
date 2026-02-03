// Manual test script for URL validation
// Run with: npx tsx test-validator.ts

import { validateUrl, validateUrls } from './lib/url-validator';

async function testMalformedUrls() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Malformed URL Handling');
  console.log('='.repeat(60) + '\n');

  const malformedUrls = [
    'not-a-url',
    'http://',
    '',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ht!tp://example.com',
  ];

  console.log('Testing malformed URLs (should handle gracefully without crashes):\n');

  let allPassed = true;
  for (const url of malformedUrls) {
    try {
      console.log(`Testing: "${url}"`);
      const result = await validateUrl(url, { timeout: 1000 });

      // Malformed URLs should be marked invalid
      if (result.valid) {
        console.log(`  ❌ FAIL: Should be invalid but marked valid`);
        allPassed = false;
      } else {
        console.log(`  ✅ PASS: Correctly marked invalid (${result.error})`);
      }
    } catch (error) {
      console.log(`  ❌ FAIL: Threw error instead of returning invalid result:`, error);
      allPassed = false;
    }
  }

  console.log(`\n${allPassed ? '✅ All malformed URL tests passed' : '❌ Some malformed URL tests failed'}\n`);
}

async function testTimeoutBehavior() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Timeout Behavior');
  console.log('='.repeat(60) + '\n');

  console.log('Testing timeout with very slow server (should abort quickly):\n');

  // Use a URL that will likely timeout (very slow DNS or connection)
  const slowUrl = 'http://example.com:81'; // Port 81 typically not used, will hang

  const start = Date.now();
  const result = await validateUrl(slowUrl, { timeout: 2000, retries: 2 });
  const duration = Date.now() - start;

  console.log(`Result: ${result.valid ? 'Valid' : 'Invalid'}`);
  console.log(`Error: ${result.error}`);
  console.log(`Duration: ${duration}ms`);

  // Should timeout around 2s, not wait for all retries (which would be 6s+)
  if (duration < 3000 && !result.valid && (result.error?.includes('timeout') || result.error?.includes('aborted'))) {
    console.log('✅ PASS: Request aborted quickly without retrying timeouts\n');
  } else {
    console.log('❌ FAIL: Should have aborted within ~2s without retrying\n');
  }
}

async function testRedirectLoop() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Redirect Loop Detection');
  console.log('='.repeat(60) + '\n');

  console.log('Testing redirect limit (maxRedirects=2):\n');

  // httpbin.org provides a redirect endpoint
  const redirectUrl = 'https://httpbin.org/redirect/5'; // Redirects 5 times

  const result = await validateUrl(redirectUrl, { maxRedirects: 2, timeout: 5000 });

  console.log(`Result: ${result.valid ? 'Valid' : 'Invalid'}`);
  console.log(`Error: ${result.error}`);
  console.log(`Status: ${result.status}`);

  if (!result.valid && result.error?.includes('Too many redirects')) {
    console.log('✅ PASS: Detected too many redirects\n');
  } else {
    console.log('❌ FAIL: Should have detected redirect limit\n');
  }
}

async function testRetryLogic() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Retry Logic');
  console.log('='.repeat(60) + '\n');

  console.log('Testing retry behavior with network errors:\n');
  console.log('Note: This is a manual observation test - check console for retry logs\n');

  // Test with a URL that will fail consistently
  const failingUrl = 'https://thisdoesnotexist.invalid';

  const result = await validateUrl(failingUrl, { retries: 2, timeout: 2000 });

  console.log(`Result: ${result.valid ? 'Valid' : 'Invalid'}`);
  console.log(`Error: ${result.error}`);
  console.log(`(Check console above for retry behavior - should attempt multiple times)\n`);
}

async function testCacheSize() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Cache Size Management');
  console.log('='.repeat(60) + '\n');

  console.log('Testing cache with many URLs:\n');

  // Generate test URLs
  const manyUrls = Array.from({ length: 50 }, (_, i) =>
    `https://example.com/page-${i}`
  );

  console.log(`Validating ${manyUrls.length} URLs (will be cached)...`);

  const start = Date.now();
  await validateUrls(manyUrls, { concurrency: 10, timeout: 1000 });
  const firstRun = Date.now() - start;

  console.log(`First run: ${firstRun}ms`);

  // Run again to test cache
  const cacheStart = Date.now();
  await validateUrls(manyUrls.slice(0, 10), { concurrency: 10 });
  const cacheRun = Date.now() - cacheStart;

  console.log(`Cache hit run (10 URLs): ${cacheRun}ms`);

  if (cacheRun < 100) { // Cache should be nearly instant
    console.log('✅ PASS: Cache appears to be working (very fast)\n');
  } else {
    console.log('⚠️  WARN: Cache may not be working optimally\n');
  }
}

async function runBasicTests() {
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

async function runAllTests() {
  console.log('\n' + '█'.repeat(60));
  console.log('URL VALIDATOR COMPREHENSIVE TEST SUITE');
  console.log('█'.repeat(60));

  // Run all test suites
  await runBasicTests();
  await testMalformedUrls();
  await testTimeoutBehavior();
  await testRedirectLoop();
  await testRetryLogic();
  await testCacheSize();

  console.log('\n' + '█'.repeat(60));
  console.log('ALL TESTS COMPLETE');
  console.log('█'.repeat(60) + '\n');
}

runAllTests().catch(console.error);
