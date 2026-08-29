import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../lib/presets";
import { analyzeProgram, detectToolFromSource } from "../lib/sbp";

function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
}

describe("OpenSBP static analyzer", () => {
  it("fully analyzes the baseline contour fixture", () => {
    const result = analyzeProgram("basic-contour.sbp", fixture("basic-contour.sbp"), DEFAULT_CONFIG);

    expect(result.complete).toBe(true);
    expect(result.stats.arcCount).toBe(0);
    expect(result.stats.maxFeedIpm).toBeCloseTo(270);
    expect(result.stats.chipLoad).toBeCloseTo(0.0075);
    expect(result.issues.some((item) => item.id === "rapid-in-stock")).toBe(false);
  });

  it("detects V-Carve / Vectric tool names and matches their geometry", () => {
    const detected = detectToolFromSource("' ROUTER FILE IN INCHES\n'Tool Name = Ball Nose (1/8\")\n&Tool = 5");
    expect(detected).toMatchObject({
      name: "Ball Nose (1/8\")",
      diameter: 0.125,
      number: 5,
      geometry: "ball-nose",
      source: "vectric",
    });
  });

  it("detects Fusion tool comments emitted by Autodesk's ShopBot post", () => {
    const detected = detectToolFromSource("' ROUTER FILE IN INCHES\n&Tool = 2\n&ToolName = \"1/2 in Compression 2 Flute\"");
    expect(detected).toMatchObject({
      name: "1/2 in Compression 2 Flute",
      diameter: 0.5,
      number: 2,
      geometry: "compression",
      flutes: 2,
      source: "fusion",
    });
  });

  it("reads exact structured tool metadata from the VirtualCut Fusion patch", () => {
    const detected = detectToolFromSource([
      "' ROUTER FILE IN INCHES",
      "' VirtualCut: tool-number=7",
      "' VirtualCut: tool-diameter=0.375",
      "' VirtualCut: tool-units=in",
      "' VirtualCut: tool-flutes=3",
      "' VirtualCut: tool-type=flat end mill",
      "' VirtualCut: tool-flute-length=1.25",
      "' VirtualCut: tool-description=3/8 Compression Cutter",
      "' VirtualCut: tool-vendor=Example Tools",
      "' VirtualCut: tool-product-id=ABC-123",
    ].join("\n"));

    expect(detected).toEqual({
      name: "3/8 Compression Cutter",
      diameter: 0.375,
      number: 7,
      geometry: "compression",
      flutes: 3,
      fluteLength: 1.25,
      vendor: "Example Tools",
      productId: "ABC-123",
      source: "fusion",
    });
  });

  it("uses auto-filled Fusion flute count until Job setup overrides it", () => {
    const source = [
      "' ROUTER FILE IN INCHES",
      "' VirtualCut: tool-diameter=0.5",
      "' VirtualCut: tool-units=in",
      "' VirtualCut: tool-flutes=4",
      "' VirtualCut: tool-type=flat end mill",
      "SA",
      "TR, 10000",
      "C6",
      "MS, 1, 0.5",
      "JZ, 0.5",
      "J2, 0, 0",
      "M3, 0, 0, -0.125",
      "M3, 1, 0, -0.125",
      "C7",
      "END",
    ].join("\n");

    const autoFilledConfig = {
      ...DEFAULT_CONFIG,
      cutter: { ...DEFAULT_CONFIG.cutter, diameter: 0.5, flutes: 4 },
    };
    const autoFilledResult = analyzeProgram("fusion-metadata.sbp", source, autoFilledConfig);
    const overriddenResult = analyzeProgram("fusion-metadata.sbp", source, {
      ...autoFilledConfig,
      cutter: { ...autoFilledConfig.cutter, flutes: 2 },
    });

    expect(autoFilledResult.metadata.toolFlutes).toBe(4);
    expect(autoFilledResult.stats.chipLoad).toBeCloseTo(0.0015);
    expect(overriddenResult.metadata.toolFlutes).toBe(4);
    expect(overriddenResult.stats.chipLoad).toBeCloseTo(0.003);
    expect(overriddenResult.issues.find((item) => item.id === "tool-operator-override")?.severity).toBe("info");
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

  it("measures repeated Fusion-style contours by incremental pass depth", () => {
    const passes = [-0.125, -0.25, -0.375, -0.5, -0.625]
      .flatMap((depth) => [
        "M3, 0, 0, 0.2",
        `M3, 0, 0, ${depth}`,
        ...(depth === -0.625 ? [
          `M3, 0.4, 0, ${depth}`,
          "M3, 0.4, 0, -0.6",
          "M3, 0.6, 0, -0.6",
          `M3, 0.6, 0, ${depth}`,
        ] : []),
        `M3, 1, 0, ${depth}`,
      ]);
    const source = [
      "' ROUTER FILE IN INCHES",
      "SA",
      "TR, 10000",
      "C6",
      "MS, 1, 0.5",
      "JZ, 0.5",
      "J2, 0, 0",
      ...passes,
      "C7",
      "END",
    ].join("\n");

    const result = analyzeProgram("fusion-stepdowns.sbp", source, DEFAULT_CONFIG);

    expect(result.stats.maximumDepth).toBeCloseTo(0.625);
    expect(result.stats.maxPassDepth).toBeCloseTo(0.125);
    expect(result.issues.some((item) => item.id.startsWith("pass-depth-"))).toBe(false);
  });
});

const sampleDirectory = process.env.SBP_SAMPLE_DIR;
if (sampleDirectory && existsSync(sampleDirectory)) {
  describe("local sample corpus", () => {
    const files = readdirSync(sampleDirectory).filter((name) => name.toLowerCase().endsWith(".sbp"));

    for (const name of files) {
      it(`parses ${name} without throwing`, () => {
        const source = readFileSync(path.join(sampleDirectory, name), "utf8");
        const result = analyzeProgram(name, source, DEFAULT_CONFIG);
        expect(result.segments.length).toBeGreaterThan(0);
        expect(result.lineCount).toBeGreaterThan(0);
        expect(result.unknownCommands, `unsupported constructs in ${name}`).toEqual([]);
      });
    }
  });
} else {
  describe.skip("local sample corpus", () => {
    it("runs when SBP_SAMPLE_DIR is provided", () => {});
  });
}
