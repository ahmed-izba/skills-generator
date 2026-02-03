// URL validation module for checking link accessibility before crawling
// Performs HEAD requests with timeout, redirect following, and caching

import { ValidationResult } from "@/types";

export interface ValidationOptions {
  concurrency?: number;   // Default: 10
  timeout?: number;       // Default: 5000ms
  maxRedirects?: number;  // Default: 3
  retries?: number;       // Default: 1
}

// Default configuration
const DEFAULT_CONFIG = {
  concurrency: 10,
  timeout: 5000,
  maxRedirects: 3,
  retries: 1,
};

// In-memory cache with 5-minute TTL
const MAX_CACHE_SIZE = 1000;
const validationCache = new Map<string, { result: ValidationResult; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Clean expired cache entries
function cleanCache(): void {
  const now = Date.now();
  for (const [key, value] of validationCache.entries()) {
    if (value.expiresAt < now) {
      validationCache.delete(key);
    }
  }
}

// Get from cache if not expired
function getCached(url: string): ValidationResult | null {
  const cached = validationCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  validationCache.delete(url);
  return null;
}

// Store in cache
function setCache(url: string, result: ValidationResult): void {
  // Clean if cache is too large
  if (validationCache.size >= MAX_CACHE_SIZE) {
    cleanCache(); // Remove expired entries first

    // If still too large after cleaning, remove oldest entries (FIFO)
    if (validationCache.size >= MAX_CACHE_SIZE) {
      const entriesToRemove = validationCache.size - MAX_CACHE_SIZE + 1;
      const keysToRemove = Array.from(validationCache.keys()).slice(0, entriesToRemove);
      keysToRemove.forEach(key => validationCache.delete(key));
      console.warn(`[Validator] Cache size limit reached, removed ${entriesToRemove} oldest entries`);
    }
  }

  validationCache.set(url, {
    result,
    expiresAt: Date.now() + CACHE_TTL,
  });
}

/**
 * Validates a single URL by performing a HEAD request with retry logic.
 *
 * Uses in-memory cache with 5-minute TTL to avoid redundant checks.
 * Follows redirects recursively up to maxRedirects (default: 3).
 * Retries failed requests once by default.
 *
 * @param url - The URL to validate (must be a valid HTTP/HTTPS URL)
 * @param options - Validation options
 * @param options.timeout - Request timeout in milliseconds (default: 5000)
 * @param options.maxRedirects - Maximum redirect hops to follow (default: 3)
 * @param options.retries - Number of retry attempts for transient failures (default: 1)
 *
 * @returns Promise resolving to ValidationResult with:
 *  - valid: true if 2xx status code received
 *  - status: HTTP status code (0 for network failures)
 *  - finalUrl: Set if URL redirected (contains final destination)
 *  - error: Error message if validation failed
 *  - checkedAt: Timestamp when validation was performed
 *
 * @example
 * ```typescript
 * const result = await validateUrl('https://example.com');
 * if (result.valid) {
 *   console.log(`URL is accessible: ${result.finalUrl || result.url}`);
 * } else {
 *   console.error(`URL failed: ${result.error}`);
 * }
 * ```
 */
export async function validateUrl(
  url: string,
  options: ValidationOptions = {}
): Promise<ValidationResult> {
  const { timeout, maxRedirects, retries } = { ...DEFAULT_CONFIG, ...options };

  // Check cache first
  const cached = getCached(url);
  if (cached) {
    return cached;
  }

  let lastError: string | undefined;

  // Retry logic
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual', // Handle redirects manually
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SkillsGenerator/1.0; +URL validation)',
        },
      });

      clearTimeout(timeoutId);

      // Fallback to GET on method not allowed
      if (response.status === 405 || response.status === 501) {
        console.log(`[Validator] HEAD not supported for ${url}, trying GET with range`);

        const getController = new AbortController();
        const getTimeoutId = setTimeout(() => getController.abort(), timeout);

        try {
          response = await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: getController.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; SkillsGenerator/1.0; +URL validation)',
              'Range': 'bytes=0-0', // Request minimal data
            },
          });

          clearTimeout(getTimeoutId);
        } catch (error) {
          clearTimeout(getTimeoutId);
          throw error;
        }
      }

      // Handle redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          const result: ValidationResult = {
            url,
            valid: false,
            status: response.status,
            error: 'Redirect with no Location header',
            checkedAt: Date.now(),
          };
          setCache(url, result);
          return result;
        }

        // Resolve relative redirect URLs
        let redirectUrl = location;
        if (!location.startsWith('http')) {
          try {
            const base = new URL(url);
            redirectUrl = new URL(location, base.origin).href;
          } catch (error) {
            console.warn(`[Validator] Failed to parse redirect URL: ${location} from ${url}`, error);
            redirectUrl = location;
            // Consider: Should we mark this as invalid instead of proceeding?
          }
        }

        // Follow redirect (up to maxRedirects)
        if (maxRedirects > 0) {
          const redirectResult = await validateUrl(redirectUrl, {
            ...options,
            maxRedirects: maxRedirects - 1,
          });

          // Mark as redirected
          const result: ValidationResult = {
            url,
            valid: redirectResult.valid,
            status: response.status,
            finalUrl: redirectResult.finalUrl || redirectUrl,
            error: redirectResult.error,
            checkedAt: Date.now(),
          };
          setCache(url, result);
          return result;
        } else {
          const result: ValidationResult = {
            url,
            valid: false,
            status: response.status,
            error: 'Too many redirects',
            checkedAt: Date.now(),
          };
          setCache(url, result);
          return result;
        }
      }

      // Success: 2xx status codes
      const valid = response.status >= 200 && response.status < 300;
      const result: ValidationResult = {
        url,
        valid,
        status: response.status,
        error: valid ? undefined : `HTTP ${response.status}`,
        checkedAt: Date.now(),
      };

      setCache(url, result);
      return result;

    } catch (error) {
      // Differentiate between expected network errors and unexpected programming errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        lastError = `Network error: ${error.message}`;
      } else if (error instanceof Error && error.name === 'AbortError') {
        lastError = 'Request timeout';
        break; // Don't retry timeouts
      } else if (error instanceof Error && error.message.includes('fetch')) {
        lastError = `HTTP request failed: ${error.message}`;
      } else {
        // UNEXPECTED error - log with full context and DON'T retry
        console.error(`[Validator] UNEXPECTED ERROR validating ${url}:`, error);
        console.error(`[Validator] Error type: ${error?.constructor?.name}`);
        console.error(`[Validator] Stack trace:`, error instanceof Error ? error.stack : 'N/A');
        lastError = error instanceof Error ? error.message : 'Unknown error';
        break; // Don't retry unexpected errors
      }

      // Wait before retry (only for expected network errors)
      if (attempt < retries && !lastError.includes('timeout')) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  // All retries failed
  const result: ValidationResult = {
    url,
    valid: false,
    status: 0,
    error: lastError || 'Request failed',
    checkedAt: Date.now(),
  };

  setCache(url, result);
  return result;
}

/**
 * Validates multiple URLs in parallel with concurrency control.
 *
 * Processes URLs in batches to limit concurrent requests. Each URL
 * is validated individually using validateUrl(), which includes caching
 * and retry logic.
 *
 * @param urls - Array of URLs to validate
 * @param options - Validation options (same as validateUrl)
 * @param options.concurrency - Max parallel requests (default: 10)
 *
 * @returns Promise resolving to array of ValidationResults in same order as input
 *
 * @example
 * ```typescript
 * const urls = ['https://example.com', 'https://example.org'];
 * const results = await validateUrls(urls, { concurrency: 5 });
 * const validUrls = results.filter(r => r.valid).map(r => r.finalUrl || r.url);
 * ```
 */
export async function validateUrls(
  urls: string[],
  options: ValidationOptions = {}
): Promise<ValidationResult[]> {
  const { concurrency } = { ...DEFAULT_CONFIG, ...options };

  // Clean expired cache entries before validation
  cleanCache();

  if (urls.length === 0) {
    return [];
  }

  console.log(`[Validator] Checking ${urls.length} URLs (${concurrency} concurrent)`);
  const startTime = Date.now();

  // Process URLs in batches for concurrency control
  const results: ValidationResult[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(url => validateUrl(url, options))
    );
    results.push(...batchResults);
  }

  const duration = Date.now() - startTime;
  const validCount = results.filter(r => r.valid).length;
  const brokenCount = results.filter(r => !r.valid).length;
  const redirectedCount = results.filter(r => r.finalUrl && r.finalUrl !== r.url).length;

  console.log(`[Validator] Results: ${validCount} valid, ${brokenCount} broken, ${redirectedCount} redirected (${duration}ms)`);

  // Log broken URLs
  if (brokenCount > 0) {
    console.log(`[Validator] Broken URLs:`);
    results
      .filter(r => !r.valid)
      .forEach(r => console.log(`  ${r.url} → ${r.status || 'FAIL'} (${r.error})`));
  }

  // Log redirected URLs
  if (redirectedCount > 0) {
    console.log(`[Validator] Redirected URLs:`);
    results
      .filter(r => r.finalUrl && r.finalUrl !== r.url)
      .forEach(r => console.log(`  ${r.url} → ${r.finalUrl}`));
  }

  return results;
}
