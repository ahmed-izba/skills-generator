import { NextRequest } from "next/server";
import { searchWeb } from "@/lib/serper";
import { scrapeUrls, scrapeUrl } from "@/lib/hyperbrowser";
import { recursiveCrawl } from "@/lib/crawler";
import { classifyTopic } from "@/lib/classifier";
import { generateSkill } from "@/lib/anthropic";
import { getCachedContent, cacheContent } from "@/lib/cache";
import { validateUrls } from "@/lib/url-validator";
import { GenerateRequest, ScrapedContent, ValidationMetadata } from "@/types";

// Maximum sources to use for generation (top quality ones)
const MAX_SOURCES = 10;
// Content length limit per source (reduces API token usage)
const MAX_CONTENT_LENGTH = 2000;

// Score and rank sources by quality
function rankSources(sources: ScrapedContent[]): ScrapedContent[] {
  return sources
    .map(source => {
      let score = 0;
      
      const length = source.markdown.length;
      if (length > 1000) score += 30;
      else if (length > 500) score += 20;
      else if (length > 200) score += 10;
      
      const codeBlocks = (source.markdown.match(/```/g) || []).length / 2;
      score += codeBlocks * 5;
      
      if (source.markdown.includes('## ')) score += 10;
      if (source.markdown.includes('### ')) score += 5;
      
      const apiKeywords = ['api', 'endpoint', 'method', 'parameter', 'request', 'response'];
      const hasApiContent = apiKeywords.some(kw => source.markdown.toLowerCase().includes(kw));
      if (hasApiContent) score += 15;
      
      const officialDomains = ['docs.', 'developer.', 'api.', 'reference.'];
      if (officialDomains.some(d => source.url.includes(d))) score += 10;
      
      return { source, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ source }) => source);
}

function trimContent(sources: ScrapedContent[]): ScrapedContent[] {
  return sources.map(source => ({
    ...source,
    markdown: source.markdown.slice(0, MAX_CONTENT_LENGTH)
  }));
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const startTime = Date.now();
  
  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;
      
      const sendProgress = (phase: string, message: string, progress: number) => {
        if (isClosed) return;
        try {
          const data = JSON.stringify({ phase, message, progress });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch (error) {
          // Expected: Controller already closed
          if (error instanceof TypeError && error.message.includes('closed')) {
            return;
          }

          // Unexpected error - log with context
          console.error(`[SSE] Failed to send progress update:`, error);
          console.error(`[SSE] Phase: ${phase}, Message: ${message}, Progress: ${progress}`);

          // Mark controller as closed to prevent further attempts
          isClosed = true;
        }
      };

      const sendError = (error: string) => {
        if (isClosed) return;
        try {
          const data = JSON.stringify({ error });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          isClosed = true;
          controller.close();
        } catch (err) {
          // Expected: Controller already closed
          if (err instanceof TypeError && err.message.includes('closed')) {
            return;
          }

          // Unexpected error - log with context
          console.error(`[SSE] Failed to send error:`, err);
          console.error(`[SSE] Error message being sent: ${error}`);

          // Ensure closed flag is set
          isClosed = true;
        }
      };

      const sendComplete = (content: string, metadata: any) => {
        if (isClosed) {
          console.error(`[SSE] sendComplete called but controller already closed!`);
          return;
        }
        try {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          const payload = { 
            phase: "complete", 
            message: `Generation complete! (${duration}s)`, 
            progress: 100,
            content,
            metadata: { ...metadata, duration: `${duration}s` }
          };
          const data = JSON.stringify(payload);
          const encoded = encoder.encode(`data: ${data}\n\n`);
          
          console.log(`[SSE] Sending complete event:`);
          console.log(`  Content length: ${content.length} chars`);
          console.log(`  JSON payload: ${data.length} chars`);
          console.log(`  Encoded bytes: ${encoded.length}`);
          
          controller.enqueue(encoded);
          console.log(`[SSE] Complete event enqueued successfully`);
          
          isClosed = true;
          controller.close();
          console.log(`[SSE] Controller closed`);
        } catch (err) {
          console.error(`[SSE] Error in sendComplete:`, err);
        }
      };

      try {
        let body: GenerateRequest;
        try {
          const contentType = request.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Content-Type must be application/json');
          }
          body = await request.json();
        } catch (parseError) {
          sendError(`Invalid request: ${parseError instanceof Error ? parseError.message : 'Could not parse JSON'}`);
          return;
        }
        
        const { topic, url } = body;
        console.log(`\n========== NEW REQUEST ==========`);
        console.log(`[API] Request: topic="${topic}", url="${url}"`);

        if (!topic && !url) {
          sendError("Either topic or url is required");
          return;
        }

        const searchTopic = topic || url || "";
        let urls: string[] = [];
        let scrapedContent: ScrapedContent[] = [];
        let usedCache = false;
        let validationMetadata: ValidationMetadata | undefined;

        // OPTIMIZATION: Run cache check and web search in PARALLEL
        sendProgress("searching", "Checking cache & searching...", 5);
        
        const [cached, searchResults] = await Promise.all([
          getCachedContent(searchTopic),
          // Only search if we have a topic (not just a URL)
          topic && !url ? searchWeb(topic) : Promise.resolve([]),
        ]);
        
        // Check if cache is valid
        if (cached) {
          const successfulCached = cached.content.filter(c => c.success);
          const totalCachedChars = successfulCached.reduce((sum, c) => sum + c.markdown.length, 0);
          
          if (successfulCached.length >= 2 && totalCachedChars >= 2000) {
            console.log(`[API] Cache HIT: ${successfulCached.length} sources, ${totalCachedChars} chars`);
            scrapedContent = cached.content;
            urls = cached.urls;
            usedCache = true;
            sendProgress("searching", `Found ${successfulCached.length} cached sources`, 10);
          } else {
            console.log(`[API] Cache insufficient (${successfulCached.length} sources, ${totalCachedChars} chars)`);
          }
        }
        
        if (!usedCache) {
          console.log(`[API] Cache MISS - using search results or URL`);
          
          if (url) {
            urls = [url];
            console.log(`[API] Using direct URL: ${url}`);
          } else if (searchResults.length > 0) {
            urls = searchResults.map((result) => result.link);
            console.log(`[API] Search found ${urls.length} URLs`);
          }

          if (urls.length === 0) {
            sendError("No URLs found to scrape");
            return;
          }

          // Pre-crawl validation
          sendProgress("validating", `Checking ${urls.length} URLs...`, 12);
          const validationResults = await validateUrls(urls);
          const validUrls = validationResults
            .filter(r => r.valid)
            .map(r => r.finalUrl || r.url);
          const brokenUrls = validationResults.filter(r => !r.valid);
          const redirectedUrls = validationResults.filter(r => r.finalUrl && r.finalUrl !== r.url);
          const timeoutUrls = validationResults.filter(r => r.error?.includes('aborted') || r.error?.includes('timeout'));

          console.log(`[Validator] ${validUrls.length} valid, ${brokenUrls.length} broken`);

          if (brokenUrls.length > 0) {
            console.log(`[Validator] Broken:`, brokenUrls.map(b => `${b.url} (${b.status || 'FAIL'})`));
          }

          // Store validation metadata
          validationMetadata = {
            totalChecked: validationResults.length,
            validUrls: validUrls.length,
            brokenUrls: brokenUrls.length,
            redirectedUrls: redirectedUrls.length,
            timeoutUrls: timeoutUrls.length,
          };

          urls = validUrls;

          if (urls.length === 0) {
            // Provide detailed error information
            const errorSummary = brokenUrls
              .slice(0, 3) // Show first 3 to avoid overwhelming
              .map(b => `${b.url} (${b.status || 'TIMEOUT'}: ${b.error})`)
              .join(', ');

            const additionalCount = brokenUrls.length > 3 ? ` and ${brokenUrls.length - 3} more` : '';

            sendError(
              `All ${validationResults.length} URLs failed validation. ` +
              `Errors: ${errorSummary}${additionalCount}. ` +
              `Please check if the URLs are accessible or try different search terms.`
            );
            return;
          }

          sendProgress("crawling", `Crawling ${validUrls.length} validated sources...`, 15);
          console.log(`[API] Starting recursive crawl from ${urls.length} URLs`);

          scrapedContent = await recursiveCrawl(urls, searchTopic, true); // Skip Phase 1 validation since we just validated
          
          const successfulScrapes = scrapedContent.filter(c => c.success && !c.isPaywalled);
          const totalChars = successfulScrapes.reduce((sum, c) => sum + c.markdown.length, 0);
          
          console.log(`[API] Crawl results: ${successfulScrapes.length} success | ${totalChars} chars`);
          
          if (successfulScrapes.length === 0) {
            sendError("Failed to scrape any content from URLs");
            return;
          }
          
          // Cache in background (don't await)
          const allUrls = scrapedContent.map(c => c.url);
          cacheContent(searchTopic, allUrls, scrapedContent).catch(err => 
            console.warn(`[API] Cache write failed:`, err)
          );
        }
        
        // Process and rank sources
        const successfulScrapes = scrapedContent.filter(c => c.success);
        const paywalledUrls = scrapedContent.filter(c => c.isPaywalled).map(c => c.url);
        
        const rankedSources = rankSources(successfulScrapes);
        const selectedSources = trimContent(rankedSources.slice(0, MAX_SOURCES));
        
        const selectedChars = selectedSources.reduce((sum, s) => sum + s.markdown.length, 0);
        console.log(`[API] Selected ${selectedSources.length} sources (${selectedChars} chars)`);
        
        if (selectedSources.length < 2) {
          sendError(`Need at least 2 valid sources, only found ${selectedSources.length}`);
          return;
        }

        // OPTIMIZATION: Start classification immediately (uses Sonnet - fast)
        sendProgress("analyzing", "Classifying & preparing...", 25);
        console.log(`[API] Starting classification (Sonnet)...`);
        
        const classificationStart = Date.now();
        const classification = await classifyTopic(searchTopic, selectedSources);
        
        console.log(`[API] Classification: ${classification.type} (${((Date.now() - classificationStart) / 1000).toFixed(1)}s)`);
        sendProgress("analyzing", `${classification.type} (${classification.complexity})`, 35);

        // Generation
        sendProgress("generating", "Generating skill documentation...", 45);
        console.log(`\n[API] Starting 4-pass generation...`);
        
        let lastProgress = 45;
        const { content, warnings } = await generateSkill(
          searchTopic,
          selectedSources,
          classification,
          (phase, message, progress) => {
            let mappedProgress = 45 + (progress * 0.50);
            lastProgress = mappedProgress;
            sendProgress(phase, message, mappedProgress);
          }
        );
        
        console.log(`\n[API] Generation complete: ${content.length} chars`);
        
        if (!content || content.length === 0) {
          console.error(`[API] ERROR: Empty content received`);
          sendError("Failed to generate content - received empty response");
          return;
        }

        // Check if any sources used the fallback strategy
        const fallbackUsed = selectedSources.some(s => (s as any).fallbackUsed);

        // Extract crawler warnings from results (Phase 2 failures, etc.)
        const crawlerWarnings: string[] = [];
        if (scrapedContent.length > 0 && (scrapedContent[0] as any)._warnings) {
          crawlerWarnings.push(...(scrapedContent[0] as any)._warnings);
        }

        const metadata = {
          topic: searchTopic,
          scrapedCount: selectedSources.length,
          totalUrls: urls.length,
          discoveredUrls: scrapedContent.length,
          topicType: classification.type,
          complexity: classification.complexity,
          usedCache,
          paywalledCount: paywalledUrls.length,
          totalChars: selectedChars,
          validation: validationMetadata,
          warnings: [
            ...(validationMetadata && validationMetadata.brokenUrls > 0
              ? [`${validationMetadata.brokenUrls} broken URLs excluded (404/403/500)`]
              : []),
            ...(validationMetadata && validationMetadata.timeoutUrls > 0
              ? [`${validationMetadata.timeoutUrls} URLs timed out (network too slow or unreachable)`]
              : []),
            ...(validationMetadata && validationMetadata.redirectedUrls > 0
              ? [`${validationMetadata.redirectedUrls} URLs redirected to different locations`]
              : []),
            ...(paywalledUrls.length > 0
              ? [`${paywalledUrls.length} source(s) paywalled/blocked${fallbackUsed ? ' (fallback used)' : ''}`]
              : []),
            ...(fallbackUsed
              ? ['Some sources flagged as paywalled but used due to substantial content (>1000 chars)']
              : []),
            ...crawlerWarnings,
            ...warnings,
          ],
          generatedAt: new Date().toISOString(),
        };

        console.log(`\n[API] Sending response:`);
        console.log(`  Content: ${content.length} chars`);
        console.log(`  Warnings: ${metadata.warnings.length > 0 ? metadata.warnings.join(', ') : 'none'}`);
        console.log(`========== REQUEST COMPLETE ==========\n`);
        
        sendComplete(content, metadata);

      } catch (error) {
        console.error(`[API] ERROR:`, error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        sendError(errorMessage);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
