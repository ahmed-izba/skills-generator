import { SearchResult } from "@/types";

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;

  if (!apiKey) {
    throw new Error("SERPER_API_KEY is not configured");
  }

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: 15, // Increased from 3 to 15 for expert mode
      }),
    });

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.organic || data.organic.length === 0) {
      throw new Error("No search results found");
    }

    // Filter out social media, video sites, and forums for better quality
    const excludedDomains = [
      "youtube.com",
      "facebook.com", 
      "twitter.com",
      "reddit.com",
      "quora.com",
      "pinterest.com",
      "tiktok.com",
      "instagram.com"
    ];

    const filtered = data.organic.filter((result: any) => {
      const url = result.link.toLowerCase();
      return !excludedDomains.some(domain => url.includes(domain));
    });

    return filtered.slice(0, 15).map((result: any) => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet || "",
    }));
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to search web: ${error.message}`);
    }
    throw new Error("Failed to search web: Unknown error");
  }
}
