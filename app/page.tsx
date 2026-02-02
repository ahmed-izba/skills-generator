"use client";

import { useState } from "react";
import Image from "next/image";
import InputSection from "@/components/input-section";
import PreviewSection from "@/components/preview-section";
import ProgressIndicator, { ErrorMessage, WarningMessages } from "@/components/progress-indicator";


interface Metadata {
  topic: string;
  scrapedCount: number;
  totalUrls: number;
  topicType: string;
  complexity: string;
  usedCache: boolean;
  paywalledCount: number;
  warnings: string[];
  generatedAt: string;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedContent, setGeneratedContent] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ phase: "", message: "", percent: 0 });
  const [metadata, setMetadata] = useState<Metadata | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      return;
    }

    setLoading(true);
    setError("");
    setGeneratedContent("");
    setMetadata(null);
    setProgress({ phase: "searching", message: "Initializing...", percent: 0 });

    try {
      const isUrl = topic.startsWith("http://") || topic.startsWith("https://");
      
      // Prepare request body
      const requestBody = {
        [isUrl ? "url" : "topic"]: topic.trim(),
      };
      
      console.log(`[Client] Sending request:`, requestBody);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      
      console.log(`[Client] Response status: ${response.status}`);

      if (!response.ok) {
        throw new Error("Failed to start generation");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let receivedComplete = false;

      const processLine = (line: string) => {
        if (!line.startsWith("data: ")) return false;
        
        try {
          const jsonStr = line.slice(6);
          console.log(`[Client] Processing SSE event (${jsonStr.length} chars)`);
          
          const data = JSON.parse(jsonStr);
          
          if (data.error) {
            console.error(`[Client] Error event received:`, data.error);
            setError(data.error);
            setLoading(false);
            return true; // Signal to stop processing
          }

          if (data.phase === "complete") {
            console.log(`[Client] Complete event received:`, {
              hasContent: !!data.content,
              hasMetadata: !!data.metadata,
              contentLength: data.content?.length || 0
            });
            
            if (!data.content) {
              console.error(`[Client] ERROR: No content in complete event`);
              console.error(`[Client] Full data object keys:`, Object.keys(data));
              setError("Generation completed but no content received. Check server logs.");
              setLoading(false);
              return true;
            }
            
            receivedComplete = true;
            setGeneratedContent(data.content);
            setMetadata(data.metadata || null);
            setLoading(false);
            return true; // Signal to stop processing
          }

          setProgress({
            phase: data.phase,
            message: data.message,
            percent: data.progress,
          });
          return false;
        } catch (e) {
          console.error(`[Client] Failed to parse SSE data:`, e);
          console.error(`[Client] Line length: ${line.length}`);
          console.error(`[Client] Line preview: ${line.slice(0, 200)}...`);
          return false;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log(`[Client] Stream done. Buffer remaining: ${buffer.length} chars`);
          // Process any remaining buffer content
          if (buffer.trim()) {
            console.log(`[Client] Processing remaining buffer...`);
            const remainingLines = buffer.split("\n\n").filter(l => l.trim());
            for (const line of remainingLines) {
              if (processLine(line)) break;
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // Split on double newline (SSE event separator)
        const events = buffer.split("\n\n");
        // Keep the last potentially incomplete event in the buffer
        buffer = events.pop() || "";

        for (const event of events) {
          const trimmedEvent = event.trim();
          if (trimmedEvent && processLine(trimmedEvent)) {
            // If processLine returns true, we're done
            return;
          }
        }
      }
      
      // Stream ended
      if (!receivedComplete) {
        console.error(`[Client] ERROR: Stream ended without receiving complete event`);
        console.error(`[Client] Final buffer contents (${buffer.length} chars):`, buffer.slice(0, 500));
        setError("Connection closed unexpectedly. The generation may have failed silently.");
        setLoading(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      console.error("[Client] Error generating skill:", err);
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fafafa] bg-[url('/grid.svg')] text-black font-sans selection:bg-black selection:text-white pb-24 relative">
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-20">
        
        {/* Header */}
        <header className="flex flex-col items-center mb-16 relative">
          <div className="mb-8">
            <Image
              src="/logo.svg"
              alt="HyperSkill Logo"
              width={60}
              height={96}
              className="text-black"
              priority
            />
          </div>
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-4 text-center leading-[0.9]">
            HYPER<span className="text-transparent bg-clip-text bg-gradient-to-b from-gray-500 to-black">SKILL</span>
          </h1>
          <p className="text-xl md:text-2xl font-medium text-gray-500 max-w-2xl text-center leading-tight">
            Auto-generate <span className="text-black font-bold bg-gray-200 px-1">SKILL.md</span> documentation for your AI agents from any web source.
          </p>
          
          <div className="mt-6 text-sm font-bold uppercase tracking-widest text-gray-400">
            Built with <a href="https://hyperbrowser.ai" target="_blank" className="text-black underline decoration-2 underline-offset-4 hover:bg-black hover:text-white transition-all px-1">Hyperbrowser</a>
          </div>
          
          {/* Expert Mode Badge */}
          <div className="mt-4 inline-flex items-center gap-2 bg-black text-white px-3 py-1 text-xs font-bold uppercase tracking-wider">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            Expert Mode Enabled
          </div>
        </header>

        {/* Input Section */}
        <div className="mb-12">
          <InputSection
            value={topic}
            onChange={setTopic}
            onGenerate={handleGenerate}
            loading={loading}
          />
        </div>

        {/* Progress Indicator */}
        {loading && (
          <ProgressIndicator
            phase={progress.phase}
            message={progress.message}
            progress={progress.percent}
          />
        )}

        {/* Error Message */}
        {error && <ErrorMessage error={error} />}

        {/* Metadata & Warnings */}
        {metadata && (
          <WarningMessages warnings={metadata.warnings} />
        )}

        {/* Preview Section */}
        {generatedContent && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
            {metadata && (
              <div className="w-full max-w-5xl mx-auto mb-6 flex flex-wrap gap-4 text-xs font-mono uppercase tracking-wider text-gray-500">
                <span className="bg-gray-200 px-2 py-1">
                  Type: <span className="text-black font-bold">{metadata.topicType}</span>
                </span>
                <span className="bg-gray-200 px-2 py-1">
                  Complexity: <span className="text-black font-bold">{metadata.complexity}</span>
                </span>
                <span className="bg-gray-200 px-2 py-1">
                  Sources: <span className="text-black font-bold">{metadata.scrapedCount}/{metadata.totalUrls}</span>
                </span>
                {metadata.usedCache && (
                  <span className="bg-green-100 text-green-800 px-2 py-1">
                    Cached
                  </span>
                )}
              </div>
            )}
            <PreviewSection content={generatedContent} />
          </div>
        )}
      </div>
    </main>
  );
}
