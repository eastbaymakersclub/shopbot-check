import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_FILENAME, DEMO_SBP } from "../lib/demo";
import { DEFAULT_CONFIG } from "../lib/presets";
import { analyzeProgram } from "../lib/sbp";

function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
}

describe("OpenSBP static analyzer", () => {
  it("fully analyzes the synthetic demonstration", () => {
    const result = analyzeProgram(DEMO_FILENAME, DEMO_SBP, DEFAULT_CONFIG);

    expect(result.complete).toBe(true);
    expect(result.stats.arcCount).toBe(8);
    expect(result.stats.maxFeedIpm).toBeCloseTo(270);
    expect(result.stats.chipLoad).toBeCloseTo(0.0075);
    expect(result.issues.some((item) => item.id === "rapid-in-stock")).toBe(false);
  });

  it("reports a rapid that enters material", () => {
    const result = analyzeProgram("unsafe-rapid.sbp", fixture("unsafe-rapid.sbp"), DEFAULT_CONFIG);
    expect(result.issues.find((item) => item.id === "rapid-in-stock")?.severity).toBe("error");
  });

  it("calculates a safe table-base zero range for negative coordinates", () => {
    const result = analyzeProgram("unsafe-bounds.sbp", fixture("unsafe-bounds.sbp"), DEFAULT_CONFIG);
    expect(result.bounds.minX).toBe(-1);
    expect(result.zeroRange.x.min).toBeCloseTo(0.5);
    expect(result.issues.some((item) => item.id === "negative-coordinates")).toBe(true);
  });

  it("fails closed when a construct is unsupported", () => {
    const result = analyzeProgram("unsupported.sbp", "' ROUTER FILE IN INCHES\nSA\nZZ,1,2\nEND", DEFAULT_CONFIG);
    expect(result.complete).toBe(false);
    expect(result.unknownCommands).toContain("ZZ");
    expect(result.issues.find((item) => item.id === "unsupported-commands")?.severity).toBe("error");
  });

  it("converts metric coordinates to canonical inches", () => {
    const source = "' ROUTER FILE IN MM\nSA\nMS,25.4,12.7\nJ3,25.4,50.8,6.35\nEND";
    const result = analyzeProgram("metric.sbp", source, DEFAULT_CONFIG);
    expect(result.metadata.units).toBe("mm");
    expect(result.bounds.maxX).toBeCloseTo(1);
    expect(result.bounds.maxY).toBeCloseTo(2);
    expect(result.bounds.maxZ).toBeCloseTo(0.25);
  });
});

const sampleDirectory = process.env.SBP_SAMPLE_DIR;
describe.skipIf(!sampleDirectory || !existsSync(sampleDirectory))("local sample corpus", () => {
  const files = readdirSync(sampleDirectory as string).filter((name) => name.toLowerCase().endsWith(".sbp"));

  for (const name of files) {
    it(`parses ${name} without throwing`, () => {
      const source = readFileSync(path.join(sampleDirectory as string, name), "utf8");
      const result = analyzeProgram(name, source, DEFAULT_CONFIG);
      expect(result.segments.length).toBeGreaterThan(0);
      expect(result.lineCount).toBeGreaterThan(0);
      expect(result.unknownCommands, `unsupported constructs in ${name}`).toEqual([]);
    });
  }
});
