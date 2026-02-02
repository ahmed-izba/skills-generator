"use client";

import { Loader2, Search, Globe, Brain, FileText, CheckCircle, AlertCircle } from "lucide-react";

interface ProgressIndicatorProps {
  phase: string;
  message: string;
  progress: number;
}

const phases = {
  searching: { icon: Search, label: "Searching" },
  crawling: { icon: Globe, label: "Crawling" },
  analyzing: { icon: Brain, label: "Analyzing" },
  generating: { icon: FileText, label: "Generating" },
  validating: { icon: CheckCircle, label: "Validating" },
  complete: { icon: CheckCircle, label: "Complete" },
};

export default function ProgressIndicator({
  phase,
  message,
  progress,
}: ProgressIndicatorProps) {
  const phaseConfig = phases[phase as keyof typeof phases] || { icon: Loader2, label: "Processing" };
  const Icon = phaseConfig.icon;

  return (
    <div className="w-full max-w-4xl mx-auto mb-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white border-4 border-black p-6 shadow-brutal">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-black text-white p-2">
            <Icon size={20} strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-bold text-lg">{phaseConfig.label}</div>
            <div className="text-gray-500 text-sm">{message}</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative h-4 bg-gray-200 border-2 border-black overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-black transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Progress Text */}
        <div className="flex justify-between mt-2 text-xs font-mono uppercase tracking-wider">
          <span className="text-gray-500">Expert Mode</span>
          <span className="font-bold">{Math.round(progress)}%</span>
        </div>

        {/* Phase Indicators */}
        <div className="flex gap-2 mt-4">
          {Object.entries(phases).map(([key, config]) => {
            if (key === "complete") return null;
            const isActive = phase === key;
            const isCompleted = 
              Object.keys(phases).indexOf(phase) > Object.keys(phases).indexOf(key);
            
            return (
              <div
                key={key}
                className={`flex-1 h-1 transition-all duration-300 ${
                  isActive || isCompleted ? "bg-black" : "bg-gray-300"
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ErrorMessage({ error }: { error: string }) {
  return (
    <div className="w-full max-w-4xl mx-auto mb-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="border-4 border-red-600 bg-red-50 p-6 shadow-brutal">
        <div className="flex items-start gap-4">
          <div className="bg-red-600 text-white p-2 shrink-0">
            <AlertCircle size={20} strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-bold text-lg text-red-800">Error</div>
            <p className="text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WarningMessages({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="w-full max-w-5xl mx-auto mb-6 animate-in fade-in">
      <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="text-yellow-600 shrink-0 mt-0.5" size={18} />
          <div>
            <div className="font-bold text-yellow-800 text-sm uppercase tracking-wide">
              Warnings
            </div>
            <ul className="mt-2 space-y-1">
              {warnings.map((warning, index) => (
                <li key={index} className="text-yellow-700 text-sm">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
