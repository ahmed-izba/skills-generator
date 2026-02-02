import { Hyperbrowser } from "@hyperbrowser/sdk";
import { ScrapedContent } from "@/types";

// Configuration constants
const PAYWALL_THRESHOLD = 50; // Score 0-100
const MIN_CONTENT_LENGTH = 300; // Reduced from 500
const SUBSTANTIAL_CONTENT_LENGTH = 1000; // For fallback

// Keywords categorized by confidence level
const PAYWALL_KEYWORDS = {
  high: [
    "subscription required",
    "access denied",
    "authentication required",
    "paywall"
  ],
  medium: [
    "premium",
    "sign up to read",
    "create an account",
    "subscribe to continue"
  ],
  low: [
    "sign in",
    "signin",
    "login",
    "please log in",
    "subscribe"
  ]
};

/**
 * Calculate paywall score (0-100) based on multiple factors
 * Higher score = more likely to be paywalled
 */
function calculatePaywallScore(content: string, url: string): number {
  const lowerContent = content.toLowerCase();
  const contentLength = content.length;
  let score = 0;

  // Factor 1: Content length penalties
  if (contentLength < MIN_CONTENT_LENGTH) {
    score += 40;
  } else if (contentLength < SUBSTANTIAL_CONTENT_LENGTH) {
    score += 15;
  }

  // Factor 2: Keyword matching with frequency analysis
  // High confidence keywords - always count
  for (const keyword of PAYWALL_KEYWORDS.high) {
    const occurrences = (lowerContent.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
    if (occurrences > 0) {
      score += 30 * Math.min(occurrences, 2); // Cap at 2 occurrences
    }
  }

  // Medium confidence keywords
  for (const keyword of PAYWALL_KEYWORDS.medium) {
    const occurrences = (lowerContent.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
    if (occurrences > 0) {
      score += 15 * Math.min(occurrences, 2);
    }
  }

  // Low confidence keywords - require multiple occurrences
  for (const keyword of PAYWALL_KEYWORDS.low) {
    const occurrences = (lowerContent.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
    if (occurrences >= 2) {
      score += 10;
    }
  }

  // Factor 3: Keyword density (if content is substantial)
  if (contentLength > 200) {
    const allKeywords = [
      ...PAYWALL_KEYWORDS.high,
      ...PAYWALL_KEYWORDS.medium,
      ...PAYWALL_KEYWORDS.low
    ];
    const totalKeywordMatches = allKeywords.reduce((count, keyword) => {
      return count + (lowerContent.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
    }, 0);

    const density = (totalKeywordMatches / contentLength) * 100;
    if (density > 2) {
      score += 20;
    }
  }

  return Math.min(score, 100); // Cap at 100
}

export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  const apiKey = process.env.HYPERBROWSER_API_KEY;

  if (!apiKey) {
    throw new Error("HYPERBROWSER_API_KEY is not configured");
  }

  const crawledAt = new Date().toISOString();

  try {
    const client = new Hyperbrowser({
      apiKey: apiKey,
    });

    const result = await client.scrape.startAndWait({
      url: url,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    });

    // Extract markdown content from the result
    const markdown = (result as any).data?.markdown || "";

    // Calculate paywall score using intelligent detection
    const paywallScore = calculatePaywallScore(markdown, url);
    const isPaywalled = paywallScore >= PAYWALL_THRESHOLD;

    console.log(`[Hyperbrowser] ${url}:`, {
      contentLength: markdown.length,
      paywallScore,
      isPaywalled,
      success: !isPaywalled && markdown.length > 0
    });

    return {
      url,
      markdown,
      success: !isPaywalled && markdown.length > 0,
      isPaywalled,
      crawledAt,
    };
  } catch (error) {
    console.error(`Failed to scrape ${url}:`, error);
    return {
      url,
      markdown: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      crawledAt,
    };
  }
}

export async function scrapeUrls(urls: string[]): Promise<ScrapedContent[]> {
  // Scrape with concurrency limit of 5
  const CONCURRENCY = 5;
  const results: ScrapedContent[] = [];
  
  console.log(`[scrapeUrls] Starting batch processing of ${urls.length} URLs with concurrency ${CONCURRENCY}`);
  
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    console.log(`[scrapeUrls] Processing batch ${Math.floor(i/CONCURRENCY) + 1}/${Math.ceil(urls.length/CONCURRENCY)}: ${batch.join(', ')}`);
    
    const batchPromises = batch.map(url => scrapeUrl(url));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Log batch results
    batchResults.forEach(r => {
      console.log(`[scrapeUrls] Result for ${r.url}: success=${r.success}, isPaywalled=${r.isPaywalled}, length=${r.markdown.length}${r.error ? ', error='+r.error : ''}`);
    });
    
    // Small delay between batches to avoid rate limiting
    if (i + CONCURRENCY < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Filter out failed scrapes but keep at least some content
  const successfulResults = results.filter((r) => r.success && r.markdown.length > 0);
  const paywalledResults = results.filter((r) => r.isPaywalled);
  const failedResults = results.filter((r) => !r.success && !r.isPaywalled);

  console.log(`[scrapeUrls] Summary: ${successfulResults.length} successful, ${paywalledResults.length} paywalled, ${failedResults.length} failed`);

  if (failedResults.length > 0) {
    console.log(`[scrapeUrls] Failed URLs:`, failedResults.map(r => ({ url: r.url, error: r.error })));
  }

  if (successfulResults.length === 0) {
    // FALLBACK: Use paywalled content if it has substantial content
    const substantialPaywalledResults = paywalledResults.filter(
      r => r.markdown.length >= SUBSTANTIAL_CONTENT_LENGTH && !r.error
    );

    if (substantialPaywalledResults.length > 0) {
      console.warn(`[scrapeUrls] All URLs flagged as paywalled, using ${substantialPaywalledResults.length} with substantial content (>=${SUBSTANTIAL_CONTENT_LENGTH} chars)`);

      return substantialPaywalledResults.map(r => ({
        ...r,
        success: true,
        isPaywalled: true,
        fallbackUsed: true,
      }));
    }

    throw new Error(`Failed to scrape any URLs successfully. All ${results.length} URLs failed or were paywalled.`);
  }

  return [...successfulResults, ...paywalledResults];
}
