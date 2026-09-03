import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VIRTUALCUT_POST_PATCH_VERSION } from "../lib/fusion-post";
import { DEFAULT_CONFIG } from "../lib/presets";
import { analyzeProgram, detectProgramMetadata, detectToolFromSource, stockConfigFromMetadata } from "../lib/sbp";

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
    expect(result.issues.find((item) => item.id === "inch-units")?.severity).toBe("pass");
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

  it("reads Fusion stock bounds and maps their work-relative origin into machine coordinates", () => {
    const source = [
      "' ROUTER FILE IN INCHES",
      `' VirtualCut: post-version=${VIRTUALCUT_POST_PATCH_VERSION}`,
      "' VirtualCut: stock-shape=box",
      "' VirtualCut: stock-units=in",
      "' VirtualCut: stock-coordinate-space=work",
      "' VirtualCut: stock-min-x=-0.25",
      "' VirtualCut: stock-min-y=-0.125",
      "' VirtualCut: stock-min-z=-0.75",
      "' VirtualCut: stock-max-x=23.75",
      "' VirtualCut: stock-max-y=47.875",
      "' VirtualCut: stock-max-z=0",
      "' VirtualCut: stock-width=24",
      "' VirtualCut: stock-height=48",
      "' VirtualCut: stock-thickness=0.75",
      "' VirtualCut: stock-z-origin=top",
    ].join("\n");
    const metadata = detectProgramMetadata(source, DEFAULT_CONFIG);
    const stock = stockConfigFromMetadata(DEFAULT_CONFIG.stock, metadata, { x: 10, y: 5 });

    expect(metadata).toMatchObject({
      virtualCutPostVersion: VIRTUALCUT_POST_PATCH_VERSION,
      materialWidth: 24,
      materialHeight: 48,
      materialThickness: 0.75,
      stockMinX: -0.25,
      stockMinY: -0.125,
      stockCoordinateSpace: "work",
      stockSource: "fusion",
      zOrigin: "top",
    });
    expect(stock).toMatchObject({ x: 9.75, y: 4.875, width: 24, height: 48, thickness: 0.75, zOrigin: "top" });
  });

  it("converts metric Fusion stock metadata into the inch-based UI", () => {
    const source = [
      "' ROUTER FILE IN MILLIMETERS",
      `' VirtualCut: post-version=${VIRTUALCUT_POST_PATCH_VERSION}`,
      "' VirtualCut: stock-units=mm",
      "' VirtualCut: stock-coordinate-space=work",
      "' VirtualCut: stock-min-x=-6.35",
      "' VirtualCut: stock-min-y=12.7",
      "' VirtualCut: stock-width=609.6",
      "' VirtualCut: stock-height=1219.2",
      "' VirtualCut: stock-thickness=19.05",
    ].join("\n");
    const metadata = detectProgramMetadata(source, DEFAULT_CONFIG);
    const stock = stockConfigFromMetadata(DEFAULT_CONFIG.stock, metadata, { x: 10, y: 5 });

    expect(stock.x).toBeCloseTo(9.75);
    expect(stock.y).toBeCloseTo(5.5);
    expect(stock.width).toBeCloseTo(24);
    expect(stock.height).toBeCloseTo(48);
    expect(stock.thickness).toBeCloseTo(0.75);
  });

  it("passes the current VirtualCut post and warns on older or unversioned VirtualCut files", () => {
    const program = (metadataLines: string[]) => [
      "' ROUTER FILE IN INCHES",
      ...metadataLines,
      "SA",
      "TR, 10000",
      "C6",
      "MS, 1, 0.5",
      "JZ, 0.5",
      "C7",
      "END",
    ].join("\n");
    const current = analyzeProgram("current.sbp", program([
      `' VirtualCut: post-version=${VIRTUALCUT_POST_PATCH_VERSION}`,
    ]), DEFAULT_CONFIG);
    const older = analyzeProgram("older.sbp", program([
      "' VirtualCut: post-version=1.0.0",
    ]), DEFAULT_CONFIG);
    const unversioned = analyzeProgram("unversioned.sbp", program([
      "' VirtualCut: tool-diameter=0.5",
    ]), DEFAULT_CONFIG);
    const ordinary = analyzeProgram("ordinary.sbp", program([]), DEFAULT_CONFIG);

    expect(current.issues.find((item) => item.id === "virtualcut-post-current")?.severity).toBe("pass");
    expect(older.issues.find((item) => item.id === "virtualcut-post-outdated")?.severity).toBe("warning");
    expect(unversioned.issues.find((item) => item.id === "virtualcut-post-outdated")?.severity).toBe("warning");
    expect(ordinary.issues.some((item) => item.id.startsWith("virtualcut-post-"))).toBe(false);
  });

  it("keeps Job setup stock edits authoritative after metadata is loaded", () => {
    const source = [
      "' ROUTER FILE IN INCHES",
      `' VirtualCut: post-version=${VIRTUALCUT_POST_PATCH_VERSION}`,
      "' VirtualCut: stock-units=in",
      "' VirtualCut: stock-width=24",
      "' VirtualCut: stock-height=12",
      "' VirtualCut: stock-thickness=0.75",
      "SA",
      "TR, 10000",
      "C6",
      "MS, 1, 0.5",
      "JZ, 1",
      "C7",
      "END",
    ].join("\n");
    const result = analyzeProgram("overridden-stock.sbp", source, {
      ...DEFAULT_CONFIG,
      stock: { ...DEFAULT_CONFIG.stock, width: 30, height: 20, thickness: 1 },
    });

    expect(result.metadata).toMatchObject({ materialWidth: 24, materialHeight: 12, materialThickness: 0.75 });
    expect(result.effectiveStock).toMatchObject({ width: 30, height: 20, thickness: 1 });
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

  it("uses machine-coordinate work zero to validate negative coordinates against machine and stock", () => {
    const source = fixture("unsafe-bounds.sbp");
    const result = analyzeProgram("unsafe-bounds.sbp", source, DEFAULT_CONFIG);
    const positioned = analyzeProgram("unsafe-bounds.sbp", source, {
      ...DEFAULT_CONFIG,
      workOffset: { x: 0.75, y: 0.5 },
    });

    expect(result.bounds.minX).toBe(-1);
    expect(result.zeroRange.x.min).toBeCloseTo(0.5);
    expect(result.zeroRange.stock?.x.min).toBeCloseTo(0.75);
    expect(result.issues.find((item) => item.id === "current-zero-outside")?.severity).toBe("error");
    expect(result.issues.find((item) => item.id === "stock-envelope")?.severity).toBe("warning");
    expect(result.issues.some((item) => item.id === "negative-coordinates")).toBe(false);

    expect(positioned.issues.some((item) => item.id === "current-zero-outside")).toBe(false);
    expect(positioned.issues.find((item) => item.id === "machine-envelope")?.severity).toBe("pass");
    expect(positioned.issues.find((item) => item.id === "negative-coordinates-positioned")?.severity).toBe("pass");
    expect(positioned.issues.find((item) => item.id === "stock-envelope")?.severity).toBe("pass");
  });

  it("allows one cutter radius of stock overhang and respects stock position", () => {
    const source = fixture("unsafe-bounds.sbp");
    const atAllowance = analyzeProgram("unsafe-bounds.sbp", source, {
      ...DEFAULT_CONFIG,
      stock: { ...DEFAULT_CONFIG.stock, x: 10, y: 5 },
      workOffset: { x: 10.75, y: 5.5 },
    });
    const beyondAllowance = analyzeProgram("unsafe-bounds.sbp", source, {
      ...DEFAULT_CONFIG,
      stock: { ...DEFAULT_CONFIG.stock, x: 10, y: 5 },
      workOffset: { x: 10.74, y: 5.49 },
    });

    expect(atAllowance.zeroRange.stock?.x.min).toBeCloseTo(10.75);
    expect(atAllowance.zeroRange.stock?.y.min).toBeCloseTo(5.5);
    expect(atAllowance.issues.find((item) => item.id === "stock-envelope")?.severity).toBe("pass");
    expect(beyondAllowance.issues.find((item) => item.id === "stock-envelope")?.severity).toBe("warning");
  });

  it("fails closed when a construct is unsupported", () => {
    const result = analyzeProgram("unsupported.sbp", "' ROUTER FILE IN INCHES\nSA\nZZ,1,2\nEND", DEFAULT_CONFIG);
    expect(result.complete).toBe(false);
    expect(result.unknownCommands).toContain("ZZ");
    expect(result.issues.find((item) => item.id === "unsupported-commands")?.severity).toBe("error");
  });

  it("rejects a metric unit guard while converting coordinates for analysis", () => {
    const source = "' ROUTER FILE\nSA\nIF %(25)=0 THEN GOTO UNIT_ERROR\nMS,25.4,12.7\nJ3,25.4,50.8,6.35\nEND";
    const result = analyzeProgram("metric.sbp", source, DEFAULT_CONFIG);
    expect(result.metadata.units).toBe("mm");
    expect(result.metadata.unitsSource).toBe("unit-guard");
    expect(result.bounds.maxX).toBeCloseTo(1);
    expect(result.bounds.maxY).toBeCloseTo(2);
    expect(result.bounds.maxZ).toBeCloseTo(0.25);
    expect(result.issues.find((item) => item.id === "metric-units")?.severity).toBe("error");
  });

  it.each([
    { zOrigin: "top" as const, stockSurface: 0 },
    { zOrigin: "table" as const, stockSurface: DEFAULT_CONFIG.stock.thickness },
  ])("rejects cutting more than 0.02 inches beneath stock with $zOrigin Z zero", ({ zOrigin, stockSurface }) => {
    const sourceAtDepth = (depth: number) => [
      "' ROUTER FILE IN INCHES",
      "SA",
      "TR, 10000",
      "C6",
      "MS, 1, 0.5",
      `JZ, ${(stockSurface + 0.25).toFixed(8)}`,
      "J2, 1, 1",
      `M3, 1, 1, ${(stockSurface - depth).toFixed(8)}`,
      "C7",
      "END",
    ].join("\n");
    const config = {
      ...DEFAULT_CONFIG,
      stock: { ...DEFAULT_CONFIG.stock, zOrigin },
    };
    const allowedDepth = DEFAULT_CONFIG.stock.thickness + 0.02;
    const excessiveDepth = DEFAULT_CONFIG.stock.thickness + 0.0201;
    const allowed = analyzeProgram("allowed-cut-through.sbp", sourceAtDepth(allowedDepth), config);
    const excessive = analyzeProgram("excessive-cut-through.sbp", sourceAtDepth(excessiveDepth), config);

    expect(allowed.stats.maximumDepth).toBeCloseTo(allowedDepth, 6);
    expect(allowed.issues.find((item) => item.id === "stock-cut-depth")?.severity).toBe("pass");
    expect(excessive.issues.find((item) => item.id === "stock-cut-depth")?.severity).toBe("error");
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

  it("measures step-downs when Fusion shifts the ramp between passes", () => {
    const passes = [-0.125, -0.25, -0.375]
      .flatMap((depth, index) => [
        `M3, ${1 - index * 0.05}, 0, 0.2`,
        `M3, ${0.1 - index * 0.025}, 0, ${depth}`,
        `M3, 0.1, 0, ${depth}`,
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
      "M3, 1, 0, 0.2",
      "C7",
      "END",
    ].join("\n");
    const config = {
      ...DEFAULT_CONFIG,
      cutter: { ...DEFAULT_CONFIG.cutter, diameter: 0.25 },
    };

    const result = analyzeProgram("fusion-shifted-ramps.sbp", source, config);

    expect(result.stats.maximumDepth).toBeCloseTo(0.375);
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
