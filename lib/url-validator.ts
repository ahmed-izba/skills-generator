// URL validation module for checking link accessibility before crawling
// Performs HEAD requests with timeout, redirect following, and caching

export interface ValidationResult {
  url: string;
  valid: boolean;
  status: number;
  finalUrl?: string;      // If redirected
  error?: string;         // Error details
  checkedAt: number;
}

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
  validationCache.set(url, {
    result,
    expiresAt: Date.now() + CACHE_TTL,
  });
}

// Validate a single URL with retries
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

      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual', // Handle redirects manually
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SkillsGenerator/1.0; +URL validation)',
        },
      });

      clearTimeout(timeoutId);

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
          } catch {
            redirectUrl = location;
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
      lastError = error instanceof Error ? error.message : 'Unknown error';

      // Don't retry on timeout or abort
      if (lastError.includes('aborted') || lastError.includes('timeout')) {
        break;
      }

      // Wait before retry
      if (attempt < retries) {
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

// Validate multiple URLs in parallel with concurrency control
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
