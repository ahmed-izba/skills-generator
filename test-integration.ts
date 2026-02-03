// Integration test for URL validation in the full generation pipeline
// Run with: npx tsx test-integration.ts

async function testGeneration() {
  console.log('Testing URL Validation Integration\n');
  console.log('Generating a skill to test the full pipeline...\n');

  const response = await fetch('http://localhost:3000/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: 'React testing library',
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('No response body');
  }

  let buffer = '';
  let lastProgress = '';
  let finalResult: any = null;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const data = line.slice(6);
      if (!data.trim()) continue;

      try {
        const event = JSON.parse(data);

        if (event.phase && event.message) {
          if (event.message !== lastProgress) {
            console.log(`[${event.phase.toUpperCase()}] ${event.message} (${event.progress}%)`);
            lastProgress = event.message;
          }
        }

        if (event.error) {
          console.error('\n❌ Error:', event.error);
          return;
        }

        if (event.phase === 'complete') {
          finalResult = event;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  if (finalResult) {
    console.log('\n' + '='.repeat(60));
    console.log('GENERATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Content length: ${finalResult.content?.length || 0} characters`);

    if (finalResult.metadata) {
      console.log('\nMetadata:');
      console.log(`  Topic: ${finalResult.metadata.topic}`);
      console.log(`  Type: ${finalResult.metadata.topicType}`);
      console.log(`  Complexity: ${finalResult.metadata.complexity}`);
      console.log(`  Scraped sources: ${finalResult.metadata.scrapedCount}`);
      console.log(`  Total URLs: ${finalResult.metadata.totalUrls}`);
      console.log(`  Duration: ${finalResult.metadata.duration}`);

      if (finalResult.metadata.validation) {
        console.log('\n🔍 URL Validation Results:');
        console.log(`  Total checked: ${finalResult.metadata.validation.totalChecked}`);
        console.log(`  Valid URLs: ${finalResult.metadata.validation.validUrls}`);
        console.log(`  Broken URLs: ${finalResult.metadata.validation.brokenUrls}`);
        console.log(`  Redirected URLs: ${finalResult.metadata.validation.redirectedUrls}`);
        console.log(`  Timeout URLs: ${finalResult.metadata.validation.timeoutUrls}`);
      } else {
        console.log('\n⚠️  No validation metadata found (cache might have been used)');
      }

      if (finalResult.metadata.warnings && finalResult.metadata.warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        finalResult.metadata.warnings.forEach((w: string) => console.log(`  - ${w}`));
      }
    }

    console.log('\n✅ Test completed successfully!');
  } else {
    console.error('\n❌ No final result received');
  }
}

testGeneration().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
