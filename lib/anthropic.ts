import Anthropic from "@anthropic-ai/sdk";
import { ScrapedContent, TopicClassification } from "@/types";
import { getTemplateForType } from "./classifier";
import { getAnthropicClient } from "./anthropic-client";
import { validateUrls } from "./url-validator";

// =============================================================================
// MODEL CONFIGURATION - Hybrid Sonnet/Opus approach
// =============================================================================
const MODEL_FAST = "claude-sonnet-4-20250514";     // For analysis, fixes
const MODEL_QUALITY = "claude-opus-4-5-20251101";  // For main generation

// Token limits per pass (optimized for speed)
const TOKENS_ANALYSIS = 3000;    // Pass 1: structured extraction
const TOKENS_GENERATION = 12000; // Pass 2: main content (500-800 lines target)
const TOKENS_FIX = 8000;         // Pass 3/4: add missing sections

// Quality thresholds for Pass 1 (triggers Opus fallback if not met)
const MIN_TRIGGERS = 2;
const MIN_INDICATORS = 3;
const MIN_ERRORS = 2;

// Content limits
const MAX_CONTEXT_PER_SOURCE = 1500;

// =============================================================================
// SYSTEM PROMPT
// =============================================================================
const SYSTEM_PROMPT_BASE = `You are an expert at creating SKILL.md files for Claude Code AI agents.

A SKILL.md file teaches Claude how to work with a specific technology. The goal is to make Claude IMMEDIATELY PRODUCTIVE with minimal context lookup.

## REQUIRED SKILL.md FORMAT

### 1. Frontmatter (YAML)
\`\`\`yaml
---
name: kebab-case-name (max 64 chars)
description: >
  Use when [specific trigger conditions]. Triggers include [file patterns],
  [CLI commands], [package imports], [directory structures]. Max 1024 chars.
---
\`\`\`

### 2. Required Sections (ALL 10 MUST BE PRESENT)

1. **# Title** - Technology name
2. **## Overview** - 2-3 sentences explaining what it is and its primary use case
3. **## When to Use** - Bullet list of specific scenarios
4. **## When NOT to Use** - Bullet list of anti-patterns, limitations, better alternatives
5. **## Detecting [Technology] Projects** - How Claude identifies this tech (files, directories, imports, config)
6. **## Quick Start Workflow** - Numbered decision tree for the most common task
7. **## Core Concepts** - Key abstractions with brief explanations
8. **## Examples** - SMALL composable snippets (10-20 lines each), labeled by pattern
9. **## Guardrails & Boundaries** - DO NOT rules, constraints, security requirements
10. **## Troubleshooting** - Error messages mapped to causes and solutions
11. **## Sources** - Annotated list (URL + what it covers)

### 3. CRITICAL QUALITY RULES

**Trigger Conditions** (in description):
- BAD: "triggers on mentions of X"
- GOOD: "triggers when user is in directory with .x/ folder, references x.config.js, or imports from @x/package"

**Examples**:
- BAD: 50-100 line monolithic examples
- GOOD: 10-20 line snippets, each labeled by pattern name
- Use format: "### Example: [Pattern Name]" followed by minimal code

**Troubleshooting**:
- BAD: "Issue: X not working"
- GOOD: "Error: 'exact error message text' → Cause: X → Solution: Y"

**Sources**:
- BAD: Just URLs
- GOOD: "- [Getting Started](url) - Setup and installation"

**Target**: 500-800 lines (quality over quantity)

### 4. OUTPUT FORMAT RULES

**CRITICAL**: Output the raw SKILL.md content directly. 
- DO NOT wrap output in \`\`\`markdown code fences
- DO NOT add \`\`\` at the beginning or end
- Start directly with the --- frontmatter
- The output IS the file content, not a code example`;

// Shorter system prompt for fix passes
const SYSTEM_PROMPT_FIX = `You are an expert at improving SKILL.md files for Claude Code AI agents.
Your task is to add missing sections to an existing SKILL.md while preserving the good content.
Output the complete improved SKILL.md directly, without markdown code fences.`;

// Minimal system prompt for analysis (Pass 1) - reduces tokens significantly
const SYSTEM_PROMPT_ANALYSIS = `Extract structured information from documentation. Be thorough and specific.
Output in the exact format requested. Focus on actionable details like file patterns, CLI commands, error messages.`;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Strip markdown code fences from output
function stripCodeFences(content: string): string {
  let result = content.trim();
  
  if (result.startsWith('```markdown')) {
    result = result.slice('```markdown'.length);
  } else if (result.startsWith('```md')) {
    result = result.slice('```md'.length);
  } else if (result.startsWith('```')) {
    result = result.slice(3);
  }
  
  if (result.endsWith('```')) {
    result = result.slice(0, -3);
  }
  
  return result.trim();
}

// Analyze content for required sections
function analyzeContent(content: string) {
  const cleanContent = stripCodeFences(content);
  const lines = cleanContent.split('\n');
  return {
    hasFrontmatter: cleanContent.startsWith('---'),
    hasOverview: /## Overview/i.test(content),
    hasWhenToUse: /## When to Use/i.test(content),
    hasWhenNotToUse: /## When NOT to Use/i.test(content),
    hasDetecting: /## Detecting|## Project Detection|## Recognizing/i.test(content),
    hasQuickStart: /## Quick Start/i.test(content),
    hasCoreConcepts: /## Core Concepts/i.test(content),
    hasExamples: /## Examples/i.test(content),
    hasGuardrails: /## Guardrails/i.test(content),
    hasTroubleshooting: /## Troubleshooting/i.test(content),
    hasSources: /## Sources/i.test(content),
    lineCount: lines.length,
    charCount: content.length,
    lastLine: lines[lines.length - 1]?.trim() || '',
    hasSmallExamples: (content.match(/### Example:/gi) || []).length >= 3,
    hasErrorMessages: /Error:|error message|`[^`]+`.*→/i.test(content),
  };
}

// Build annotated sources list
function buildAnnotatedSources(scrapedData: ScrapedContent[]): string {
  return scrapedData.map(s => {
    const urlPath = new URL(s.url).pathname;
    let category = "General";
    if (/getting-started|quickstart|intro/i.test(urlPath)) category = "Setup & Installation";
    else if (/api|reference/i.test(urlPath)) category = "API Reference";
    else if (/guide|tutorial/i.test(urlPath)) category = "Guides & Tutorials";
    else if (/example|sample/i.test(urlPath)) category = "Examples";
    else if (/troubleshoot|debug|error/i.test(urlPath)) category = "Troubleshooting";
    return `- ${s.url} - ${category}`;
  }).join('\n');
}

// Build context from scraped data
function buildContext(scrapedData: ScrapedContent[], maxSources?: number): string {
  const sources = maxSources ? scrapedData.slice(0, maxSources) : scrapedData;
  return sources
    .map((content, index) => {
      const limitedContent = content.markdown.slice(0, MAX_CONTEXT_PER_SOURCE);
      return `Source ${index + 1}: ${content.url}\n${limitedContent}\n---\n`;
    })
    .join("\n");
}

// =============================================================================
// PASS 1: ANALYSIS (Sonnet with Opus fallback)
// =============================================================================
interface AnalysisData {
  outline: string;
  keyPoints: string[];
  triggers: string[];
  projectIndicators: string[];
  commonErrors: string[];
  limitations: string[];
}

async function pass1Analysis(
  anthropic: Anthropic,
  topic: string,
  scrapedData: ScrapedContent[],
  classification: TopicClassification,
  useOpus: boolean = false
): Promise<AnalysisData> {
  const model = useOpus ? MODEL_QUALITY : MODEL_FAST;
  const context = buildContext(scrapedData, 8);
  const template = getTemplateForType(classification.type);

  console.log(`[Pass 1] Using ${useOpus ? 'Opus (fallback)' : 'Sonnet'}, ${scrapedData.slice(0, 8).length} sources`);

  const userPrompt = `Analyze documentation for "${topic}" (${classification.type}, ${classification.complexity})

SOURCES:
${context}

Extract the following in this EXACT format:

TRIGGERS:
[List specific conditions when Claude should use this skill]
- File patterns (e.g., "*.gadget.ts files", ".gadget/ directory")
- CLI commands (e.g., "ggt dev", "npm run gadget")
- Import patterns (e.g., "import from 'gadget-server'")
- Config files (e.g., "gadget.json", "shopify.app.toml")

PROJECT_INDICATORS:
[How to detect this technology in a codebase]
- Directory structure patterns
- Key files that indicate this tech
- Package.json dependencies
- Import statements

COMMON_ERRORS:
[Extract actual error messages and their causes from docs]
- "exact error text" → cause → solution

LIMITATIONS:
[When NOT to use this technology]
- Anti-patterns
- Use cases it doesn't support well
- Better alternatives for certain scenarios

OUTLINE:
[Section-by-section outline for all 10 required sections]

KEY_POINTS:
- [Critical facts, APIs, parameters, gotchas]`;

  const response = await anthropic.messages.create({
    model,
    max_tokens: TOKENS_ANALYSIS,
    system: SYSTEM_PROMPT_ANALYSIS, // Use minimal prompt for faster analysis
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = response.content[0]?.type === "text" ? response.content[0].text : "";

  // Parse structured sections
  const parseSection = (name: string): string[] => {
    const regex = new RegExp(`${name}:([\\s\\S]*?)(?=TRIGGERS:|PROJECT_INDICATORS:|COMMON_ERRORS:|LIMITATIONS:|OUTLINE:|KEY_POINTS:|$)`, 'i');
    const match = content.match(regex);
    if (!match) return [];
    return match[1].trim().split('\n').filter(line => line.trim().startsWith('-')).map(line => line.trim().substring(1).trim());
  };

  const triggers = parseSection('TRIGGERS');
  const projectIndicators = parseSection('PROJECT_INDICATORS');
  const commonErrors = parseSection('COMMON_ERRORS');
  const limitations = parseSection('LIMITATIONS');

  const outlineMatch = content.match(/OUTLINE:([\s\S]*?)(?=KEY_POINTS:|$)/);
  const keyPointsMatch = content.match(/KEY_POINTS:([\s\S]*)/);

  const outline = outlineMatch ? outlineMatch[1].trim() : content;
  const keyPointsText = keyPointsMatch ? keyPointsMatch[1].trim() : "";
  const keyPoints = keyPointsText.split("\n").filter(line => line.trim().startsWith("-")).map(line => line.trim().substring(1).trim());

  console.log(`[Pass 1] Extracted: ${triggers.length} triggers, ${projectIndicators.length} indicators, ${commonErrors.length} errors, ${limitations.length} limitations`);

  // Check quality thresholds - retry with Opus if too weak
  if (!useOpus && (triggers.length < MIN_TRIGGERS || projectIndicators.length < MIN_INDICATORS || commonErrors.length < MIN_ERRORS)) {
    console.log(`[Pass 1] Weak extraction (triggers=${triggers.length}, indicators=${projectIndicators.length}, errors=${commonErrors.length})`);
    console.log(`[Pass 1] Retrying with Opus for better extraction...`);
    return pass1Analysis(anthropic, topic, scrapedData, classification, true);
  }

  return { outline, keyPoints, triggers, projectIndicators, commonErrors, limitations };
}

// =============================================================================
// PASS 2: CONTENT GENERATION (Opus - quality critical)
// =============================================================================
async function pass2ContentGeneration(
  anthropic: Anthropic,
  topic: string,
  scrapedData: ScrapedContent[],
  classification: TopicClassification,
  analysisData: AnalysisData
): Promise<string> {
  // OPTIMIZATION: Only use top 6 sources for context (analysisData has extracted key info)
  const context = buildContext(scrapedData, 6);
  const annotatedSources = buildAnnotatedSources(scrapedData);

  console.log(`[Pass 2] Using Opus, ${Math.min(6, scrapedData.length)} sources (of ${scrapedData.length})`);

  const userPrompt = `Generate SKILL.md for "${topic}"

## ANALYSIS DATA

TRIGGER CONDITIONS (use in frontmatter description):
${analysisData.triggers.length > 0 ? analysisData.triggers.map(t => `- ${t}`).join('\n') : '- Reference to ' + topic + ' in user message or codebase'}

PROJECT INDICATORS (for "Detecting Projects" section):
${analysisData.projectIndicators.length > 0 ? analysisData.projectIndicators.map(p => `- ${p}`).join('\n') : '- Look for technology-specific files and imports'}

WHEN NOT TO USE:
${analysisData.limitations.length > 0 ? analysisData.limitations.map(l => `- ${l}`).join('\n') : '- Determine from documentation context'}

COMMON ERRORS (for Troubleshooting - include exact error text):
${analysisData.commonErrors.length > 0 ? analysisData.commonErrors.map(e => `- ${e}`).join('\n') : '- Extract from documentation examples'}

OUTLINE:
${analysisData.outline}

KEY POINTS:
${analysisData.keyPoints.slice(0, 15).join("\n")}

## SOURCE DOCUMENTATION
${context}

## ANNOTATED SOURCES (for Sources section):
${annotatedSources}

## GENERATION INSTRUCTIONS

Generate a COMPLETE SKILL.md with these EXACT sections in order:

1. **Frontmatter**: Include SPECIFIC trigger conditions (file patterns, CLI commands, imports)
2. **## Overview**: 2-3 sentences only
3. **## When to Use**: Bullet list of specific scenarios
4. **## When NOT to Use**: Limitations, anti-patterns, better alternatives
5. **## Detecting [Topic] Projects**: Directory structure, config files, package dependencies, import patterns
6. **## Quick Start Workflow**: Numbered decision tree for the most common task
7. **## Core Concepts**: Key abstractions with 1-2 sentence explanations
8. **## Examples**: Small composable snippets (10-20 lines each), labeled "### Example: [Pattern Name]"
9. **## Guardrails & Boundaries**: "NEVER do X because Y", "ALWAYS do Z before W", security requirements
10. **## Troubleshooting**: "**Error: \`exact error message\`**" with Cause and Solution
11. **## Sources**: "- [Title](URL) - What this covers" format

Target: 500-800 lines. Output ONLY the SKILL.md content (no code fences):`;

  const response = await anthropic.messages.create({
    model: MODEL_QUALITY,
    max_tokens: TOKENS_GENERATION,
    system: SYSTEM_PROMPT_BASE,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = response.content[0]?.type === "text" ? response.content[0].text : "";
  const analysis = analyzeContent(content);
  
  console.log(`[Pass 2] Output: ${analysis.charCount} chars, ${analysis.lineCount} lines`);
  console.log(`[Pass 2] Sections: WhenNot=${analysis.hasWhenNotToUse}, Detecting=${analysis.hasDetecting}, QuickStart=${analysis.hasQuickStart}, Sources=${analysis.hasSources}`);

  return content;
}

// =============================================================================
// PASS 3: FIX MISSING SECTIONS (Sonnet - surgical fixes)
// =============================================================================
async function pass3FixSections(
  anthropic: Anthropic,
  topic: string,
  scrapedData: ScrapedContent[],
  currentContent: string,
  analysisData: AnalysisData,
  missingSections: string[]
): Promise<string> {
  const annotatedSources = buildAnnotatedSources(scrapedData);

  console.log(`[Pass 3] Using Sonnet to fix: ${missingSections.join(', ')}`);

  const userPrompt = `Improve this SKILL.md for "${topic}" by adding the missing sections.

CURRENT CONTENT:
${currentContent.slice(0, 10000)}

MISSING SECTIONS TO ADD:
${missingSections.map(s => `- ${s}`).join('\n')}

ADDITIONAL DATA:
${analysisData.limitations.length > 0 ? `\nLIMITATIONS (for "When NOT to Use"):\n${analysisData.limitations.map(l => `- ${l}`).join('\n')}` : ''}
${analysisData.projectIndicators.length > 0 ? `\nPROJECT INDICATORS (for "Detecting Projects"):\n${analysisData.projectIndicators.map(p => `- ${p}`).join('\n')}` : ''}
${analysisData.commonErrors.length > 0 ? `\nERROR MESSAGES (for Troubleshooting):\n${analysisData.commonErrors.map(e => `- ${e}`).join('\n')}` : ''}

SOURCES TO ADD (if Sources section is missing):
${annotatedSources}

INSTRUCTIONS:
1. Add the missing sections listed above
2. Keep ALL existing good content
3. If examples are too large (50+ lines each), break them into 10-20 line snippets
4. Return the COMPLETE improved SKILL.md

Output the full SKILL.md (no code fences):`;

  const response = await anthropic.messages.create({
    model: MODEL_FAST,
    max_tokens: TOKENS_FIX,
    system: SYSTEM_PROMPT_FIX,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = response.content[0]?.type === "text" ? response.content[0].text : "";
  const analysis = analyzeContent(content);
  
  console.log(`[Pass 3] Output: ${analysis.charCount} chars, ${analysis.lineCount} lines`);

  return content;
}

// Helper function to extract URLs from Sources section
function extractSourceUrls(content: string): string[] {
  const sourceSection = content.match(/## Sources\n\n([\s\S]*?)(\n##|$)/);
  if (!sourceSection) return [];

  const urlRegex = /https?:\/\/[^\s\)]+/g;
  return [...new Set(sourceSection[1].match(urlRegex) || [])];
}

// =============================================================================
// PASS 4: VALIDATION (Local analysis + optional Sonnet fix)
// =============================================================================
async function pass4Validate(
  anthropic: Anthropic,
  topic: string,
  scrapedData: ScrapedContent[],
  currentContent: string
): Promise<{ content: string; warnings: string[] }> {
  const analysis = analyzeContent(currentContent);
  const warnings: string[] = [];
  const criticalMissing: string[] = [];

  // Check for critical missing sections
  if (!analysis.hasWhenNotToUse) criticalMissing.push('When NOT to Use');
  if (!analysis.hasDetecting) criticalMissing.push('Detecting Projects');
  if (!analysis.hasQuickStart) criticalMissing.push('Quick Start Workflow');
  if (!analysis.hasSources) criticalMissing.push('Sources');
  if (!analysis.hasGuardrails) criticalMissing.push('Guardrails');
  if (!analysis.hasTroubleshooting) criticalMissing.push('Troubleshooting');

  // Validate URLs in final output
  const sourceUrls = extractSourceUrls(currentContent);
  if (sourceUrls.length > 0) {
    console.log(`[Pass 4] Validating ${sourceUrls.length} final source URLs`);
    const sourceValidation = await validateUrls(sourceUrls);
    const brokenSources = sourceValidation.filter(r => !r.valid);

    if (brokenSources.length > 0) {
      warnings.push(`${brokenSources.length} broken URLs in final sources section`);
      console.log(`[Pass 4] Broken sources:`, brokenSources.map(b => b.url));
    }
  }

  // Quality warnings (non-blocking)
  if (!analysis.hasSmallExamples) warnings.push('Examples may be too large - prefer 10-20 line snippets');
  if (!analysis.hasErrorMessages) warnings.push('Troubleshooting section should include actual error messages');
  if (analysis.lineCount < 300) warnings.push(`Only ${analysis.lineCount} lines (target: 500-800)`);
  if (analysis.lineCount > 1200) warnings.push(`${analysis.lineCount} lines is too long (target: 500-800)`);

  console.log(`[Pass 4] Local check: ${criticalMissing.length} critical missing, ${warnings.length} warnings`);

  // If nothing critical is missing, return immediately (NO LLM call)
  if (criticalMissing.length === 0) {
    console.log(`[Pass 4] All sections present - skipping LLM call`);
    return { content: currentContent, warnings };
  }

  // Critical sections missing - do ONE quick Sonnet fix
  console.log(`[Pass 4] Missing: ${criticalMissing.join(', ')} - running Sonnet fix`);
  
  const annotatedSources = buildAnnotatedSources(scrapedData);

  const userPrompt = `Add the missing sections to this SKILL.md for "${topic}".

CURRENT CONTENT:
${currentContent.slice(0, 8000)}

CRITICAL MISSING SECTIONS (must add):
${criticalMissing.map(s => `- ${s}`).join('\n')}

${criticalMissing.includes('Sources') ? `\nSOURCES TO ADD:\n${annotatedSources}` : ''}

INSTRUCTIONS:
1. Add ALL missing sections listed above
2. Keep existing good content unchanged
3. Return the COMPLETE SKILL.md

Output the full SKILL.md (no code fences):`;

  const response = await anthropic.messages.create({
    model: MODEL_FAST,
    max_tokens: TOKENS_FIX,
    system: SYSTEM_PROMPT_FIX,
    messages: [{ role: "user", content: userPrompt }],
  });

  const fixedContent = response.content[0]?.type === "text" ? response.content[0].text : "";
  const fixedAnalysis = analyzeContent(fixedContent);

  // Update warnings based on final state
  if (!fixedAnalysis.hasSources) warnings.push("Missing Sources section");
  if (!fixedAnalysis.hasGuardrails) warnings.push("Missing Guardrails");
  if (!fixedAnalysis.hasTroubleshooting) warnings.push("Missing Troubleshooting");

  console.log(`[Pass 4] Fixed: ${fixedAnalysis.charCount} chars, ${fixedAnalysis.lineCount} lines`);

  return { content: fixedContent, warnings };
}

// =============================================================================
// MAIN GENERATION FUNCTION
// =============================================================================
export async function generateSkill(
  topic: string,
  scrapedData: ScrapedContent[],
  classification: TopicClassification,
  onProgress?: (phase: string, message: string, progress: number) => void
): Promise<{ content: string; warnings: string[] }> {
  const anthropic = getAnthropicClient(); // Use singleton client
  const startTime = Date.now();
  
  console.log(`\n[Generate] Starting: "${topic}" (${classification.type})`);
  console.log(`[Generate] Hybrid mode: Sonnet for analysis/fixes, Opus for generation`);
  console.log(`[Generate] Sources: ${scrapedData.length} with ${scrapedData.reduce((sum, c) => sum + c.markdown.length, 0)} chars`);

  try {
    // Pass 1: Analysis (Sonnet with Opus fallback)
    onProgress?.("analyzing", "Extracting triggers, errors, limitations...", 10);
    const pass1Start = Date.now();
    const analysisData = await pass1Analysis(anthropic, topic, scrapedData, classification);
    console.log(`[Pass 1] ${((Date.now() - pass1Start) / 1000).toFixed(1)}s`);

    // Pass 2: Content Generation (Opus)
    onProgress?.("generating", "Generating content with Opus...", 30);
    const pass2Start = Date.now();
    let content = await pass2ContentGeneration(anthropic, topic, scrapedData, classification, analysisData);
    console.log(`[Pass 2] ${((Date.now() - pass2Start) / 1000).toFixed(1)}s`);

    // Check if Pass 3 is needed
    const analysis = analyzeContent(content);
    const missingSections: string[] = [];
    if (!analysis.hasWhenNotToUse) missingSections.push('"When NOT to Use" section');
    if (!analysis.hasDetecting) missingSections.push('"Detecting Projects" section');
    if (!analysis.hasQuickStart) missingSections.push('"Quick Start Workflow" section');
    if (!analysis.hasSmallExamples) missingSections.push('Small composable examples');
    if (!analysis.hasErrorMessages) missingSections.push('Error messages in Troubleshooting');
    if (!analysis.hasSources) missingSections.push('Sources section');

    // Pass 3: Fix missing sections (Sonnet)
    if (missingSections.length > 0) {
      onProgress?.("generating", "Fixing missing sections...", 60);
      const pass3Start = Date.now();
      content = await pass3FixSections(anthropic, topic, scrapedData, content, analysisData, missingSections);
      console.log(`[Pass 3] ${((Date.now() - pass3Start) / 1000).toFixed(1)}s`);
    } else {
      console.log(`[Pass 3] SKIPPED - all sections present`);
    }

    // Pass 4: Validation (Local + optional Sonnet fix)
    onProgress?.("validating", "Final validation...", 80);
    const pass4Start = Date.now();
    const { content: finalContent, warnings } = await pass4Validate(anthropic, topic, scrapedData, content);
    console.log(`[Pass 4] ${((Date.now() - pass4Start) / 1000).toFixed(1)}s`);

    // Clean and return
    const cleanedContent = stripCodeFences(finalContent);
    const finalAnalysis = analyzeContent(cleanedContent);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n[Generate] Complete: ${totalTime}s`);
    console.log(`[Generate] Result: ${cleanedContent.length} chars, ${finalAnalysis.lineCount} lines`);
    console.log(`[Generate] Sections: WhenNot=${finalAnalysis.hasWhenNotToUse}, Detecting=${finalAnalysis.hasDetecting}, QuickStart=${finalAnalysis.hasQuickStart}`);
    console.log(`[Generate] Quality: SmallExamples=${finalAnalysis.hasSmallExamples}, ErrorMsgs=${finalAnalysis.hasErrorMessages}`);
    console.log(`[Generate] Warnings: ${warnings.length > 0 ? warnings.join(', ') : 'none'}\n`);

    onProgress?.("finalizing", `Generation finished (${totalTime}s)`, 95);

    return { content: cleanedContent, warnings };
  } catch (error) {
    console.error("[Generate] ERROR:", error);
    throw new Error(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
