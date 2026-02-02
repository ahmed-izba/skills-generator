import { TopicClassification, TopicType, ScrapedContent } from "@/types";

const CLASSIFICATION_PROMPT = `You are an expert at analyzing technical documentation and classifying topics.

Analyze the topic and scraped content to classify it into one of these types:
- library: A software library (e.g., React, Lodash, Axios)
- framework: A development framework (e.g., Next.js, Django, Rails)
- tool: A development tool (e.g., ESLint, Prettier, Webpack)
- cli: A command-line interface tool (e.g., Git CLI, Vercel CLI)
- api_service: An API or web service (e.g., Stripe API, Twilio, SendGrid)
- concept: A programming concept or pattern (e.g., Dependency Injection, MVC)
- pattern: A design or architectural pattern (e.g., Factory Pattern, Observer)
- platform: A development platform (e.g., Vercel, AWS, Firebase)

Also assess:
- complexity: simple (basic usage), moderate (some configuration needed), or complex (enterprise/advanced features)
- keyAspects: 3-5 major themes found in the documentation
- recommendedSections: Based on the type, which sections should be included in a skill file
- confidence: 0.0 to 1.0

Respond in this exact JSON format:
{
  "type": "library|framework|tool|cli|api_service|concept|pattern|platform",
  "complexity": "simple|moderate|complex",
  "keyAspects": ["aspect1", "aspect2", "aspect3"],
  "recommendedSections": ["section1", "section2", "section3", "section4", "section5", "section6"],
  "confidence": 0.9
}`;

import { getAnthropicClient } from "./anthropic-client";

export async function classifyTopic(
  topic: string,
  scrapedData: ScrapedContent[]
): Promise<TopicClassification> {
  const anthropic = getAnthropicClient(); // Use singleton client

  // Prepare context from scraped content (limit to first 3 sources for classification)
  const context = scrapedData
    .slice(0, 3)
    .map((content, index) => {
      // Limit content length to avoid token overflow
      const limitedContent = content.markdown.slice(0, 3000);
      return `Source ${index + 1}: ${content.url}\n\n${limitedContent}\n\n---\n`;
    })
    .join("\n");

  const userPrompt = `Topic: "${topic}"

Analyze the following scraped documentation:

${context}

Classify this topic and provide your analysis in the specified JSON format.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514", // Fast model for classification
      max_tokens: 1000,
      system: CLASSIFICATION_PROMPT,
      messages: [
        { role: "user", content: userPrompt }
      ],
    });

    const content = response.content[0]?.type === "text" 
      ? response.content[0].text 
      : "";

    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse classification response");
    }

    const classification = JSON.parse(jsonMatch[0]) as TopicClassification;
    
    // Validate the classification
    if (!classification.type || !classification.complexity) {
      throw new Error("Invalid classification format");
    }

    return classification;
  } catch (error) {
    console.error("Error classifying topic:", error);
    // Return a default classification if parsing fails
    return {
      type: "library" as TopicType,
      complexity: "moderate",
      keyAspects: ["usage", "configuration", "examples"],
      recommendedSections: [
        "Overview",
        "Installation",
        "Configuration",
        "API Reference",
        "Examples",
        "Troubleshooting"
      ],
      confidence: 0.5,
    };
  }
}

export function getTemplateForType(type: TopicType): string[] {
  const templates: Record<TopicType, string[]> = {
    library: [
      "Overview",
      "Installation",
      "Configuration",
      "API Reference",
      "Common Patterns",
      "Examples",
      "Troubleshooting",
      "Guardrails & Boundaries",
    ],
    framework: [
      "Overview",
      "Getting Started",
      "Core Concepts",
      "Configuration",
      "API Reference",
      "Examples",
      "Best Practices",
      "Troubleshooting",
      "Guardrails & Boundaries",
    ],
    tool: [
      "Overview",
      "Installation",
      "Configuration",
      "Commands",
      "Workflows",
      "Examples",
      "Best Practices",
      "Troubleshooting",
      "Guardrails & Boundaries",
    ],
    cli: [
      "Overview",
      "Installation",
      "Authentication",
      "Commands Reference",
      "Workflows",
      "Configuration",
      "Examples",
      "Troubleshooting",
      "Guardrails & Boundaries",
    ],
    api_service: [
      "Overview",
      "Authentication",
      "Endpoints",
      "Rate Limits",
      "Error Handling",
      "SDK Usage",
      "Examples",
      "Troubleshooting",
      "Guardrails & Boundaries",
    ],
    concept: [
      "Overview",
      "Explanation",
      "When to Apply",
      "Implementation Steps",
      "Best Practices",
      "Anti-patterns",
      "Examples",
      "Guardrails & Boundaries",
    ],
    pattern: [
      "Overview",
      "Problem Statement",
      "Solution",
      "Implementation",
      "Variations",
      "Best Practices",
      "Examples",
      "Guardrails & Boundaries",
    ],
    platform: [
      "Overview",
      "Getting Started",
      "Core Features",
      "Configuration",
      "Deployment",
      "Examples",
      "Best Practices",
      "Troubleshooting",
      "Guardrails & Boundaries",
    ],
  };

  return templates[type] || templates.library;
}
