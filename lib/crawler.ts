import { scrapeUrl, scrapeUrls } from "./hyperbrowser";
import { ScrapedContent } from "@/types";

// Maximum number of pages to crawl per initial URL
const MAX_PAGES_PER_URL = 8;
// Maximum total URLs to scrape
const MAX_TOTAL_URLS = 25;

// Keywords that indicate valuable documentation pages (in URL path)
const VALUABLE_PATH_KEYWORDS = [
  "/api",
  "/reference",
  "/guide",
  "/tutorial",
  "/docs",
  "/documentation",
  "/getting-started",
  "/quickstart",
  "/examples",
  "/configuration",
  "/setup",
  "/install",
  "/sdk",
  "/cli",
  "/commands",
  "/overview",
  "/introduction",
  "/concepts",
  "/basics",
  "/advanced",
  "/authentication",
  "/models",
  "/actions",
  "/connections",
  "/deployment",
];

// File extensions to EXCLUDE (not documentation pages)
const EXCLUDED_EXTENSIONS = [
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".css",
  ".js",
  ".json",
  ".xml",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp4",
  ".mp3",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
];

// Patterns to exclude from URLs
const EXCLUDED_PATTERNS = [
  "/.vite/",
  "/assets/",
  "/static/",
  "/_next/",
  "/images/",
  "/fonts/",
  "/media/",
  "#", // Fragment identifiers
  "?", // Query strings (often not unique pages)
];

function extractLinks(markdown: string, baseUrl: string): string[] {
  const links: string[] = [];
  
  // Match markdown links [text](url)
  const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = mdLinkRegex.exec(markdown)) !== null) {
    let url = match[2].trim();
    
    // Skip empty URLs
    if (!url) continue;
    
    // Handle relative URLs
    if (url.startsWith("/") && !url.startsWith("//")) {
      try {
        const base = new URL(baseUrl);
        url = `${base.origin}${url}`;
      } catch {
        continue;
      }
    }
    
    // Only include http(s) URLs
    if (url.startsWith("http://") || url.startsWith("https://")) {
      links.push(url);
    }
  }
  
  // Also try to extract href links from any HTML that might be in the markdown
  const hrefRegex = /href=["']([^"']+)["']/g;
  while ((match = hrefRegex.exec(markdown)) !== null) {
    let url = match[1].trim();
    
    if (!url || url.startsWith("#") || url.startsWith("javascript:")) continue;
    
    if (url.startsWith("/") && !url.startsWith("//")) {
      try {
        const base = new URL(baseUrl);
        url = `${base.origin}${url}`;
      } catch {
        continue;
      }
    }
    
    if (url.startsWith("http://") || url.startsWith("https://")) {
      links.push(url);
    }
  }
  
  // Deduplicate
  return [...new Set(links)];
}

function isExcludedUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  
  // Check for excluded file extensions
  for (const ext of EXCLUDED_EXTENSIONS) {
    if (lowerUrl.endsWith(ext)) {
      return true;
    }
  }
  
  // Check for excluded patterns
  for (const pattern of EXCLUDED_PATTERNS) {
    if (lowerUrl.includes(pattern)) {
      return true;
    }
  }
  
  return false;
}

function isValuableLink(url: string): boolean {
  // First check if it's excluded
  if (isExcludedUrl(url)) {
    return false;
  }
  
  const lowerUrl = url.toLowerCase();
  
  // Check if URL path contains any valuable keywords
  try {
    const urlObj = new URL(lowerUrl);
    const path = urlObj.pathname;
    
    // Check for valuable path keywords
    for (const keyword of VALUABLE_PATH_KEYWORDS) {
      if (path.includes(keyword)) {
        return true;
      }
    }
    
    // Also consider any path that's not just the root
    // (e.g., /something is likely a doc page)
    if (path.length > 1 && path !== "/") {
      // But filter out paths that are likely not documentation
      const segments = path.split("/").filter(Boolean);
      if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1];
        // If the last segment has no dots (not a file) and is reasonable length
        if (!lastSegment.includes(".") && lastSegment.length > 2 && lastSegment.length < 50) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  
  return false;
}

function isSameDomain(url1: string, url2: string): boolean {
  try {
    const domain1 = new URL(url1).hostname;
    const domain2 = new URL(url2).hostname;
    return domain1 === domain2;
  } catch {
    return false;
  }
}

// Generate common documentation subpages for a given docs URL
function generateCommonDocPaths(baseUrl: string): string[] {
  const commonPaths = [
    "/guides",
    "/guide",
    "/api",
    "/reference",
    "/docs",
    "/documentation",
    "/getting-started",
    "/quickstart",
    "/tutorial",
    "/tutorials",
    "/examples",
    "/concepts",
    "/basics",
    "/overview",
    "/introduction",
    "/authentication",
    "/configuration",
    "/installation",
    "/setup",
  ];
  
  try {
    const urlObj = new URL(baseUrl);
    const origin = urlObj.origin;
    
    return commonPaths.map(path => `${origin}${path}`);
  } catch {
    return [];
  }
}

export async function recursiveCrawl(
  initialUrls: string[],
  topic: string
): Promise<ScrapedContent[]> {
  const allUrls = new Set<string>(initialUrls);
  const crawledUrls = new Set<string>();
  const results: ScrapedContent[] = [];
  const paywalledUrls: string[] = [];
  
  console.log(`[Crawler] Starting with ${initialUrls.length} initial URLs`);
  
  // Phase 1: Scrape initial URLs IN PARALLEL and collect internal links
  console.log(`[Crawler] Phase 1: Scraping initial URLs (parallel)`);
  
  const initialBatch = initialUrls.slice(0, Math.min(initialUrls.length, 5));
  const phase1Start = Date.now();
  
  // Scrape all initial URLs in parallel
  const initialResults = await scrapeUrls(initialBatch);
  
  console.log(`[Crawler] Phase 1 parallel scrape: ${((Date.now() - phase1Start) / 1000).toFixed(1)}s`);
  
  // Process results and extract links
  for (const content of initialResults) {
    crawledUrls.add(content.url);
    
    if (content.isPaywalled) {
      console.log(`[Crawler] Paywalled: ${content.url}`);
      paywalledUrls.push(content.url);
      continue;
    }
    
    if (content.success && content.markdown.length > 0) {
      console.log(`[Crawler] Success: ${content.url} (${content.markdown.length} chars)`);
      results.push(content);
      
      // Extract links from content
      const extractedLinks = extractLinks(content.markdown, content.url);
      
      // Filter to valuable internal links
      const valuableLinks = extractedLinks.filter(link => {
        const sameDomain = isSameDomain(link, content.url);
        const isValuable = isValuableLink(link);
        const notCrawled = !crawledUrls.has(link);
        const notQueued = !allUrls.has(link);
        return sameDomain && isValuable && notCrawled && notQueued;
      });
      
      // Add valuable links to queue
      const linksToAdd = valuableLinks.slice(0, MAX_PAGES_PER_URL);
      linksToAdd.forEach(link => allUrls.add(link));
      
      // If we found very few links, try common doc paths
      if (valuableLinks.length < 3) {
        const commonPaths = generateCommonDocPaths(content.url);
        for (const path of commonPaths) {
          if (!crawledUrls.has(path) && !allUrls.has(path) && allUrls.size < MAX_TOTAL_URLS) {
            allUrls.add(path);
          }
        }
      }
    } else {
      console.log(`[Crawler] Failed or empty: ${content.url}`);
    }
  }
  
  console.log(`[Crawler] Phase 1 complete: ${results.length} pages, ${allUrls.size - crawledUrls.size} more queued`);
  
  // Phase 2: Scrape discovered URLs
  const additionalUrls = Array.from(allUrls).filter(url => !crawledUrls.has(url));
  
  if (additionalUrls.length > 0) {
    console.log(`[Crawler] Phase 2: Scraping ${additionalUrls.length} additional URLs`);
    console.log(`[Crawler] URLs:`, additionalUrls);
    
    try {
      const additionalContent = await scrapeUrls(additionalUrls);
      
      for (const content of additionalContent) {
        if (content.isPaywalled) {
          paywalledUrls.push(content.url);
        } else if (content.success && content.markdown.length > 100) {
          console.log(`[Crawler] Added: ${content.url} (${content.markdown.length} chars)`);
          results.push(content);
        }
      }
    } catch (error) {
      console.warn(`[Crawler] Phase 2 error, continuing with ${results.length} pages`);
    }
  }
  
  console.log(`[Crawler] COMPLETE: ${results.length} successful, ${paywalledUrls.length} paywalled`);
  
  // Store paywalled info
  if (paywalledUrls.length > 0 && results.length > 0) {
    (results[0] as any)._paywalledUrls = paywalledUrls;
  }
  
  return results;
}

export function getPaywalledUrls(results: ScrapedContent[]): string[] {
  const paywalled: string[] = [];
  
  for (const result of results) {
    if (result.isPaywalled) {
      paywalled.push(result.url);
    }
    if ((result as any)._paywalledUrls) {
      paywalled.push(...(result as any)._paywalledUrls);
    }
  }
  
  return [...new Set(paywalled)];
}
