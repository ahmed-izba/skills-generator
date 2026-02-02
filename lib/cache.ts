import { ScrapedContent, CachedContent } from "@/types";
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function generateCacheKey(topic: string): string {
  const normalized = topic.toLowerCase().trim().replace(/\s+/g, " ");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

export async function getCachedContent(topic: string): Promise<CachedContent | null> {
  const cacheKey = generateCacheKey(topic);
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);

  console.log(`[Cache] Looking for cache: ${cacheKey}.json`);

  if (!fs.existsSync(cachePath)) {
    console.log(`[Cache] MISS: File not found`);
    return null;
  }

  try {
    const fileSize = fs.statSync(cachePath).size;
    console.log(`[Cache] HIT: Found file (${(fileSize / 1024).toFixed(1)} KB)`);
    
    const data = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as CachedContent;
    
    // Check if cache is expired
    const now = new Date().toISOString();
    if (now > data.expiresAt) {
      console.log(`[Cache] EXPIRED: Removing old cache`);
      fs.unlinkSync(cachePath);
      return null;
    }

    const contentCount = data.content?.length || 0;
    const totalChars = data.content?.reduce((sum, c) => sum + c.markdown.length, 0) || 0;
    console.log(`[Cache] Valid: ${contentCount} sources, ${totalChars} chars`);

    return data;
  } catch (error) {
    console.error("[Cache] Error reading cache:", error);
    return null;
  }
}

export async function cacheContent(
  topic: string, 
  urls: string[], 
  content: ScrapedContent[]
): Promise<void> {
  const cacheKey = generateCacheKey(topic);
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);

  const cachedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

  const cacheData: CachedContent = {
    topic,
    urls,
    content,
    cachedAt,
    expiresAt,
  };

  const totalChars = content.reduce((sum, c) => sum + c.markdown.length, 0);
  const successfulCount = content.filter(c => c.success).length;

  console.log(`[Cache] Writing: ${content.length} sources (${successfulCount} successful, ${totalChars} chars) to ${cacheKey}.json`);

  try {
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), "utf-8");
    const fileSize = fs.statSync(cachePath).size;
    console.log(`[Cache] Saved: ${(fileSize / 1024).toFixed(1)} KB`);
  } catch (error) {
    console.error("[Cache] Error writing cache:", error);
  }
}

export async function clearCache(): Promise<void> {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(CACHE_DIR, file));
    }
  } catch (error) {
    console.error("Error clearing cache:", error);
  }
}
