# HyperSkill - Expert Mode

**Built with [Hyperbrowser](https://hyperbrowser.ai) & [Claude](https://anthropic.com)**

HyperSkill is a Next.js application that automatically generates expert-level SKILL.md files for AI coding agents using real-time web data. Enter a topic or URL, and HyperSkill will search, scrape, analyze, and generate comprehensive skill documentation using Claude 3.5 Sonnet.

## ✨ What's New in Expert Mode

### Major Upgrades from v1

- **🤖 Claude 3.5 Sonnet**: Replaced OpenAI with Claude for superior skill generation
- **🕷️ Recursive Crawling**: Scans 20+ URLs with intelligent link following
- **🎯 Auto-Topic Detection**: Automatically classifies topic type (library, framework, API, etc.)
- **🔄 4-Pass Generation**: Analysis → Content → Examples → Validation workflow
- **📊 Real-time Progress**: Streaming UI shows each phase with progress bars
- **⚡ Smart Caching**: 24-hour cache reduces regeneration time & cost
- **⚠️ Paywall Detection**: Warns about blocked sources and continues gracefully
- **📐 Adaptive Structure**: Dynamic templates based on topic type

### Output Quality Improvements

| Feature | v1 (OpenAI) | v2 (Expert) |
|---------|-------------|-------------|
| URLs Scraped | 3 | 20+ |
| Generation Passes | 1 | 4 |
| Avg Output Lines | 100-200 | 800-1500 |
| Code Examples | 1-2 basic | 3-4 comprehensive |
| Topic Detection | Manual | Auto (8 types) |
| Workflows | Vague guidance | Executable checklists |
| Guardrails | None | Full boundaries section |
| Quality Validation | None | Self-consistency checks |

## What it does

HyperSkill automates the creation of structured SKILL.md files by:

1. **🔍 Searching** the web for relevant documentation (via Serper API)
2. **🕷️ Crawling** and extracting content from 20+ sources (via Hyperbrowser SDK)
3. **🧠 Analyzing** topic type and structure (via Claude classification)
4. **✍️ Generating** comprehensive documentation (via Claude 4-pass workflow)
5. **✅ Validating** for accuracy and completeness

## Quick Start

### Prerequisites

You'll need API keys from:
- **[Anthropic](https://console.anthropic.com)** - Claude 3.5 Sonnet for generation (REQUIRED)
- **[Hyperbrowser](https://hyperbrowser.ai)** - Web scraping (REQUIRED)
- **[Serper](https://serper.dev)** - Web search (REQUIRED)

### Installation

1. Clone this repository:
```bash
git clone <your-repo-url>
cd skills-generator
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Add your API keys to `.env`:
```env
ANTHROPIC_API_KEY=your_anthropic_key
SERPER_API_KEY=your_serper_key
HYPERBROWSER_API_KEY=your_hyperbrowser_key
```

5. Start the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How to Use

1. **Enter a topic** (e.g., "Next.js 14 App Router") or **paste a URL**
2. Click **Generate** - watch the real-time progress:
   - 🔍 **Searching** - Finding relevant sources
   - 🕷️ **Crawling** - Scraping 20+ pages with link following
   - 🧠 **Analyzing** - Detecting topic type and structure
   - ✍️ **Generating** - Creating comprehensive documentation
   - ✅ **Validating** - Adding guardrails and checking accuracy
3. **Preview** the generated SKILL.md (800-1500 lines)
4. **Copy** to clipboard or **Download** as a file

### Expert Features

**Topic Auto-Detection**:
- Automatically classifies as: library, framework, tool, CLI, API service, concept, pattern, or platform
- Adapts section structure based on type
- Complexity assessment (simple/moderate/complex)

**Smart Caching**:
- Results cached for 24 hours in `.cache/` directory
- Regenerating same topic uses cache (faster & cheaper)
- Cache automatically invalidated after TTL

**Paywall Handling**:
- Detects paywalled/blocked sources
- Warns user: "⚠️ 3 sources were paywalled"
- Continues with available content
- Graceful degradation

## Tech Stack

- **Next.js 16** - App router, TypeScript
- **Tailwind CSS v4** - Styling
- **Anthropic Claude SDK** - 4-pass skill generation
- **Hyperbrowser SDK** - Recursive web scraping
- **Serper API** - Web search (15 results)
- **Server-Sent Events** - Real-time progress streaming

## Project Structure

```
skills-generator/
├── app/
│   ├── api/generate/route.ts  # Streaming API endpoint
│   ├── page.tsx               # Main UI with progress
│   └── layout.tsx             # Root layout
├── components/
│   ├── input-section.tsx      # Topic/URL input
│   ├── preview-section.tsx    # Markdown preview
│   └── progress-indicator.tsx # Real-time progress UI
├── lib/
│   ├── anthropic.ts           # Claude 4-pass generation
│   ├── classifier.ts          # Topic auto-detection
│   ├── crawler.ts             # Recursive web crawler
│   ├── cache.ts               # 24-hour file caching
│   ├── serper.ts              # Search (15 results)
│   └── hyperbrowser.ts        # Scraping with paywall detection
├── types/
│   └── index.ts               # TypeScript types
└── .cache/                    # Scraped content cache
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Claude 3.5 Sonnet API key | Yes |
| `SERPER_API_KEY` | Serper.dev search API | Yes |
| `HYPERBROWSER_API_KEY` | Hyperbrowser.ai scraping | Yes |

## Cost Analysis

**Per skill generation (Expert Mode)**:
- Serper search: ~$0.00 (subscription)
- Hyperbrowser scraping: ~$0.10 (20 URLs)
- Claude 3.5 Sonnet: ~$0.65 (4 calls × ~160K tokens)
- **Total: ~$0.75 per skill**

**With caching**: Regenerating same topic = ~$0.65 (skip scraping)

## Output Format

Generated SKILL.md files follow official Claude Code best practices:

```yaml
---
name: topic-name-kebab-case
description: Clear description with ALL trigger conditions. Max 1024 chars.
---

# Topic Name

## Overview
Brief 2-3 sentence summary

## When to Use
- Trigger condition 1
- Trigger condition 2

## [Adaptive Sections]
Sections vary by topic type (Installation, API Reference, Workflows, etc.)

## Examples
3-4 concrete, copy-paste ready examples with edge cases

## Guardrails & Boundaries
- What NOT to do
- File permissions
- Constraints

## Troubleshooting
Common issues and solutions

## Sources
- All URLs used for generation
```

## Adaptive Templates

**Library/Framework**:
- Overview, Installation, Configuration, API Reference, Common Patterns, Examples, Troubleshooting, Guardrails

**Tool/CLI**:
- Overview, Installation, Configuration, Commands, Workflows, Examples, Best Practices, Troubleshooting, Guardrails

**API Service**:
- Overview, Authentication, Endpoints, Rate Limits, Error Handling, SDK Usage, Examples, Troubleshooting, Guardrails

**Concept/Pattern**:
- Overview, Explanation, When to Apply, Implementation Steps, Best Practices, Anti-patterns, Examples, Guardrails

## Best Practices Encoded

The generator follows official Claude Code skill guidelines:

- ✅ Concise but high-signal content
- ✅ Great frontmatter with clear triggers
- ✅ Concrete examples + checklists
- ✅ Executable workflows (not vague guidance)
- ✅ Guardrails and boundaries
- ✅ Progressive disclosure (important info first)
- ✅ 800-1500 line target length
- ✅ Self-consistency validation

## License

MIT

---

Follow [@hyperbrowser](https://x.com/hyperbrowser) for updates.
