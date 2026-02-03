export interface GenerateRequest {
  topic?: string;
  url?: string;
}

export interface ValidationResult {
  url: string;
  valid: boolean;
  status: number;
  finalUrl?: string;
  error?: string;
  checkedAt: number;
}

export interface ValidationMetadata {
  totalChecked: number;
  validUrls: number;
  brokenUrls: number;
  redirectedUrls: number;
  timeoutUrls: number;
}

export interface GenerateResponse {
  content: string;
  sources: string[];
  metadata: {
    topic: string;
    scrapedCount: number;
    generatedAt: string;
    topicType?: string;
    warnings?: string[];
    validation?: ValidationMetadata;
  };
  error?: string;
}

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export interface ScrapedContent {
  url: string;
  markdown: string;
  success: boolean;
  error?: string;
  isPaywalled?: boolean;
  fallbackUsed?: boolean;
  crawledAt: string;
}

export interface CachedContent {
  topic: string;
  urls: string[];
  content: ScrapedContent[];
  cachedAt: string;
  expiresAt: string;
}

export type TopicType = 'library' | 'framework' | 'tool' | 'cli' | 'api_service' | 'concept' | 'pattern' | 'platform';

export interface TopicClassification {
  type: TopicType;
  complexity: 'simple' | 'moderate' | 'complex';
  keyAspects: string[];
  recommendedSections: string[];
  confidence: number;
}

export interface GenerationPhase {
  phase: 'searching' | 'crawling' | 'analyzing' | 'generating' | 'validating' | 'complete';
  message: string;
  progress: number;
}

export interface StreamResponse {
  phase: GenerationPhase;
  content?: string;
  error?: string;
}
