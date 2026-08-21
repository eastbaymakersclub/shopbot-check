/// <reference lib="webworker" />

import { analyzeProgram, type AnalysisConfig } from "../lib/sbp";

interface AnalyzeMessage {
  id: number;
  filename: string;
  text: string;
  config: AnalysisConfig;
}

self.onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  const { id, filename, text, config } = event.data;
  try {
    const result = analyzeProgram(filename, text, config);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "The file could not be analyzed.",
    });
  }
};

export {};
