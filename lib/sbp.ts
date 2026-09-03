export type Units = "in" | "mm";
export type ZOrigin = "top" | "table";
export type Severity = "error" | "warning" | "info" | "pass";
export type IssueCategory = "bounds" | "setup" | "tooling" | "cut-load" | "parser";

export interface AxisLimit { min: number; max: number }

export interface MachineProfile {
  id: string;
  name: string;
  units: Units;
  limits: { x: AxisLimit; y: AxisLimit; z: AxisLimit };
  moveSpeed: { xy: number; z: number };
  jogSpeed: { xy: number; z: number };
  spindle: { minRpm: number; maxRpm: number };
}

export interface CutterPreset {
  id: string;
  name: string;
  diameter: number;
  flutes: number;
  geometry: "compression" | "flat" | "ball-nose";
  chipLoad: { min: number; max: number };
  observed?: { rpm: number; feedIpm: number; plungeIpm: number };
  source: string;
}

export interface StockConfig {
  material: string;
  thickness: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zOrigin: ZOrigin;
  chipLoadFactor: number;
}

export interface AnalysisConfig {
  machine: MachineProfile;
  stock: StockConfig;
  cutter: CutterPreset;
  workOffset: { x: number; y: number };
  spoilboardAllowance: number;
}

export interface Point3 { x: number; y: number; z: number }

export interface ToolpathSegment {
  from: Point3;
  to: Point3;
  kind: "move" | "jog";
  arc: boolean;
  engaged: boolean;
  line: number;
  feedIps: number;
  plungeIps: number;
  rpm: number | null;
}

export interface AnalysisIssue {
  id: string;
  severity: Severity;
  category: IssueCategory;
  title: string;
  detail: string;
  recommendation?: string;
  line?: number;
  source?: string;
}

export interface ProgramBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface ProgramMetadata {
  units: Units;
  unitsSource: "header" | "unit-guard" | "machine-default";
  materialThickness: number | null;
  materialWidth: number | null;
  materialHeight: number | null;
  safeZ: number | null;
  zOrigin: ZOrigin;
  toolName: string | null;
  toolDiameter: number | null;
  toolNumber: number | null;
  toolGeometry: CutterPreset["geometry"] | null;
  toolFlutes: number | null;
  toolFluteLength: number | null;
  toolVendor: string | null;
  toolProductId: string | null;
  toolSource: "vectric" | "fusion" | null;
}

export interface DetectedTool {
  name: string | null;
  diameter: number | null;
  number: number | null;
  geometry: CutterPreset["geometry"] | null;
  flutes: number | null;
  fluteLength: number | null;
  vendor: string | null;
  productId: string | null;
  source: ProgramMetadata["toolSource"];
}

export interface AnalysisResult {
  filename: string;
  complete: boolean;
  score: number;
  lineCount: number;
  commandCount: number;
  unknownCommands: string[];
  segments: ToolpathSegment[];
  bounds: ProgramBounds;
  cutBounds: ProgramBounds | null;
  metadata: ProgramMetadata;
  effectiveStock: StockConfig;
  issues: AnalysisIssue[];
  stats: {
    moveCount: number;
    jogCount: number;
    arcCount: number;
    engagedMoveCount: number;
    estimatedSeconds: number;
    rpm: number | null;
    maxFeedIpm: number | null;
    maxPlungeIpm: number | null;
    chipLoad: number | null;
    adjustedChipLoadRange: { min: number; max: number } | null;
    maxPassDepth: number;
    maximumDepth: number;
  };
  zeroRange: {
    x: AxisLimit;
    y: AxisLimit;
    stock: { x: AxisLimit; y: AxisLimit } | null;
  };
}

const MAX_LINES = 500_000;
const EPSILON = 1e-7;
const GLOBAL_SETTING_COMMANDS = new Set(["VL", "VU", "VI", "VN", "VA", "ST", "VO", "VD"]);
const KNOWN_COMMANDS = new Set(["SA", "CN", "C6", "C7", "C9", "TR", "MS", "PAUSE", "JZ", "J2", "J3", "M2", "M3", "CG", "END", "SF"]);

function issue(
  severity: Severity,
  category: IssueCategory,
  id: string,
  title: string,
  detail: string,
  extra: Partial<AnalysisIssue> = {},
): AnalysisIssue {
  return { id, severity, category, title, detail, ...extra };
}

function stripComment(line: string): string {
  const index = line.indexOf("'");
  return (index >= 0 ? line.slice(0, index) : line).trim();
}

function parseFraction(value: string): number | null {
  const fraction = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator ? Number(fraction[1]) / denominator : null;
  }
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanToolName(value: string): string {
  return value.trim().replace(/^"|"$/g, "").trim();
}

function toolDiameterInches(name: string, units: Units): number | null {
  const inchValue = name.match(/(\d+\s*\/\s*\d+|\d*\.?\d+)\s*(?:["″]|\bin(?:ch(?:es)?)?\b)/i)?.[1];
  if (inchValue) return parseFraction(inchValue);
  const millimeterValue = name.match(/(\d*\.?\d+)\s*mm\b/i)?.[1];
  if (millimeterValue) {
    const parsed = Number.parseFloat(millimeterValue);
    return Number.isFinite(parsed) ? parsed / 25.4 : null;
  }
  const parenthesizedFraction = name.match(/\((\d+\s*\/\s*\d+)\)/)?.[1];
  if (parenthesizedFraction) return parseFraction(parenthesizedFraction);
  const unitValue = name.match(/(?:diameter|dia\.?|d)\s*[:=]?\s*(\d*\.?\d+)/i)?.[1];
  if (!unitValue) return null;
  const parsed = Number.parseFloat(unitValue);
  if (!Number.isFinite(parsed)) return null;
  return units === "mm" ? parsed / 25.4 : parsed;
}

function detectUnits(text: string): { units: Units; source: ProgramMetadata["unitsSource"] } | null {
  if (/UNITS\s*:\s*INCHES|ROUTER FILE IN INCHES/i.test(text)) return { units: "in", source: "header" };
  if (/UNITS\s*:\s*(?:MM|MILLIMETERS)|ROUTER FILE IN (?:MM|MILLIMETERS)/i.test(text)) return { units: "mm", source: "header" };
  if (/IF\s+%\(25\)\s*=\s*1\s+THEN\s+GOTO\s+UNIT_ERROR/i.test(text)) return { units: "in", source: "unit-guard" };
  if (/IF\s+%\(25\)\s*=\s*0\s+THEN\s+GOTO\s+UNIT_ERROR/i.test(text)) return { units: "mm", source: "unit-guard" };
  return null;
}

function firstNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function virtualCutToolField(text: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^\\s*'\\s*VirtualCut:\\s*${escaped}\\s*=\\s*(.+?)\\s*$`, "im"))?.[1]?.trim() ?? null;
}

export function detectToolFromSource(text: string): DetectedTool {
  const units = detectUnits(text)?.units ?? "in";
  const vectricName = text.match(/^\s*'\s*Tool Name\s*=\s*(.+)$/im)?.[1];
  const fusionName = text.match(/^\s*&ToolName\s*=\s*(.+)$/im)?.[1];
  const structuredType = virtualCutToolField(text, "tool-type");
  const structuredDescription = virtualCutToolField(text, "tool-description");
  const structuredComment = virtualCutToolField(text, "tool-comment");
  const rawName = structuredDescription ?? structuredComment ?? fusionName ?? vectricName ?? structuredType ?? null;
  const name = rawName ? cleanToolName(rawName) : null;
  const normalized = [structuredType, structuredDescription, structuredComment, name].filter(Boolean).join(" ").toLowerCase();
  const number = firstNumber(text, /^\s*&Tool\s*=\s*(-?\d+(?:\.\d+)?)/im)
    ?? firstNumber(text, /^\s*'\s*VirtualCut:\s*tool-number\s*=\s*(-?\d+(?:\.\d+)?)/im);
  const structuredFlutes = virtualCutToolField(text, "tool-flutes");
  const fluteText = structuredFlutes ?? normalized.match(/(\d+)\s*(?:-\s*)?flutes?\b/)?.[1] ?? null;
  const parsedFlutes = fluteText ? Number.parseInt(fluteText, 10) : null;
  const structuredUnits = virtualCutToolField(text, "tool-units")?.toLowerCase() ?? units;
  const structuredDiameter = Number.parseFloat(virtualCutToolField(text, "tool-diameter") ?? "");
  const structuredFluteLength = Number.parseFloat(virtualCutToolField(text, "tool-flute-length") ?? "");
  const structuredScale = structuredUnits === "mm" ? 1 / 25.4 : 1;
  let geometry: CutterPreset["geometry"] | null = null;
  if (/ball(?:\s+nose|\s+end)?/.test(normalized)) geometry = "ball-nose";
  else if (/compression/.test(normalized)) geometry = "compression";
  else if (/(?:flat|straight|upcut|downcut|end\s*mill)/.test(normalized)) geometry = "flat";

  return {
    name,
    diameter: Number.isFinite(structuredDiameter) ? structuredDiameter * structuredScale : name ? toolDiameterInches(name, units) : null,
    number: number === null ? null : Math.round(number),
    geometry,
    flutes: Number.isFinite(parsedFlutes) ? parsedFlutes : null,
    fluteLength: Number.isFinite(structuredFluteLength) ? structuredFluteLength * structuredScale : null,
    vendor: virtualCutToolField(text, "tool-vendor"),
    productId: virtualCutToolField(text, "tool-product-id"),
    source: structuredType || structuredDescription || structuredComment || Number.isFinite(structuredDiameter) || fusionName ? "fusion" : vectricName ? "vectric" : null,
  };
}

function extractMetadata(text: string, config: AnalysisConfig): ProgramMetadata {
  const unitsDetection = detectUnits(text);
  const units = unitsDetection?.units ?? config.machine.units;
  const unitScale = units === "mm" ? 1 / 25.4 : 1;
  const detectedTool = detectToolFromSource(text);
  const rawOrigin = text.match(/^\s*&PWZorigin\s*=\s*([^\r\n']+)/im)?.[1]?.trim() ?? "";
  const isTableOrigin = /table|bed/i.test(rawOrigin);
  const toolNumber = firstNumber(text, /^\s*&Tool\s*=\s*(-?\d+(?:\.\d+)?)/im);
  const thickness = firstNumber(text, /^\s*&PWMaterial\s*=\s*(-?\d+(?:\.\d+)?)/im)
    ?? firstNumber(text, /Depth of material in Z\s*=\s*(-?\d+(?:\.\d+)?)/i);
  const width = firstNumber(text, /Length of material in X\s*=\s*(-?\d+(?:\.\d+)?)/i);
  const height = firstNumber(text, /Length of material in Y\s*=\s*(-?\d+(?:\.\d+)?)/i);
  const safeZ = firstNumber(text, /^\s*&PWSafeZ\s*=\s*(-?\d+(?:\.\d+)?)/im)
    ?? firstNumber(text, /Safe Z\s*=\s*(-?\d+(?:\.\d+)?)/i);

  return {
    units,
    unitsSource: unitsDetection?.source ?? "machine-default",
    materialThickness: thickness === null ? null : thickness * unitScale,
    materialWidth: width === null ? null : width * unitScale,
    materialHeight: height === null ? null : height * unitScale,
    safeZ: safeZ === null ? null : safeZ * unitScale,
    zOrigin: isTableOrigin ? "table" : "top",
    toolName: detectedTool.name,
    toolDiameter: detectedTool.diameter,
    toolNumber: toolNumber === null ? null : Math.round(toolNumber),
    toolGeometry: detectedTool.geometry,
    toolFlutes: detectedTool.flutes,
    toolFluteLength: detectedTool.fluteLength,
    toolVendor: detectedTool.vendor,
    toolProductId: detectedTool.productId,
    toolSource: detectedTool.source,
  };
}

function emptyBounds(): ProgramBounds {
  return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
}

function addPoint(bounds: ProgramBounds, point: Point3): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxY = Math.max(bounds.maxY, point.y);
  bounds.minZ = Math.min(bounds.minZ, point.z);
  bounds.maxZ = Math.max(bounds.maxZ, point.z);
}

function finiteBounds(bounds: ProgramBounds): ProgramBounds {
  if (!Number.isFinite(bounds.minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  return bounds;
}

function distance(from: Point3, to: Point3): number {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}

function numberArg(value: string | undefined, scale: number, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed * scale : Number.NaN;
}

function severityWeight(severity: Severity): number {
  if (severity === "error") return 25;
  if (severity === "warning") return 8;
  if (severity === "info") return 2;
  return 0;
}

function severityOrder(severity: Severity): number {
  return { error: 0, warning: 1, info: 2, pass: 3 }[severity];
}

function formatInches(value: number): string {
  return `${value.toFixed(Math.abs(value) < 10 ? 2 : 1)}″`;
}

export function analyzeProgram(filename: string, text: string, config: AnalysisConfig): AnalysisResult {
  const sourceLines = text.replace(/\r\n?/g, "\n").split("\n");
  if (sourceLines.length > MAX_LINES) throw new Error(`Files over ${MAX_LINES.toLocaleString()} lines are not supported yet.`);

  const metadata = extractMetadata(text, config);
  const scale = metadata.units === "mm" ? 1 / 25.4 : 1;
  const effectiveStock: StockConfig = {
    ...config.stock,
    thickness: metadata.materialThickness ?? config.stock.thickness,
    width: metadata.materialWidth ?? config.stock.width,
    height: metadata.materialHeight ?? config.stock.height,
    zOrigin: metadata.zOrigin,
  };
  const stockSurface = effectiveStock.zOrigin === "top" ? 0 : effectiveStock.thickness;
  const stockBottom = effectiveStock.zOrigin === "top" ? -effectiveStock.thickness : 0;

  const segments: ToolpathSegment[] = [];
  const issues: AnalysisIssue[] = [];
  const unknown = new Set<string>();
  const programBounds = emptyBounds();
  const cuttingBounds = emptyBounds();
  const variables = new Map<string, string | number>();
  let position: Point3 = { x: 0, y: 0, z: 0 };
  let moveFeed = config.machine.moveSpeed.xy;
  let plungeFeed = config.machine.moveSpeed.z;
  let rpm: number | null = null;
  let spindleRunning = false;
  let spindleStarted = false;
  let spindleStopped = false;
  let sawAbsolute = false;
  let sawMoveSpeed = false;
  let commandCount = 0;
  let moveCount = 0;
  let jogCount = 0;
  let arcCount = 0;
  let estimatedSeconds = 0;
  let rapidBelowSurfaceCount = 0;
  let firstRapidBelowSurface: { line: number; source: string } | null = null;
  let firstCutWithoutSpindle: { line: number; source: string } | null = null;
  let maxPassDepth = 0;
  let maxPlungeIps = 0;
  const deepestPlateauByPoint = new Map<string, number>();
  let cutCycleActive = false;
  let cutCycleBaselineDepth = 0;
  let cutCycleDeepestDepth = 0;
  let cutCycleSawPlateau = false;
  let cutCyclePlateaus = new Map<string, number>();

  const cutPointKey = (point: Point3) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
  const cutDepth = (point: Point3) => Math.max(0, stockSurface - point.z);
  const finishCutCycle = () => {
    if (cutCycleActive) {
      let previousDepth = cutCycleBaselineDepth;
      if (cutCycleSawPlateau) {
        for (const key of cutCyclePlateaus.keys()) {
          const depth = deepestPlateauByPoint.get(key);
          if (depth !== undefined && depth <= cutCycleDeepestDepth + EPSILON) {
            previousDepth = Math.max(previousDepth, depth);
          }
        }
      }
      maxPassDepth = Math.max(maxPassDepth, cutCycleDeepestDepth - previousDepth);
      for (const [key, depth] of cutCyclePlateaus) {
        deepestPlateauByPoint.set(key, Math.max(deepestPlateauByPoint.get(key) ?? 0, depth));
      }
    }
    cutCycleActive = false;
    cutCycleBaselineDepth = 0;
    cutCycleDeepestDepth = 0;
    cutCycleSawPlateau = false;
    cutCyclePlateaus = new Map<string, number>();
  };
  const beginCutCycle = (from: Point3, to: Point3) => {
    let entry = from;
    if (from.z >= stockSurface - EPSILON && to.z < stockSurface - EPSILON && Math.abs(to.z - from.z) > EPSILON) {
      const amount = (stockSurface - from.z) / (to.z - from.z);
      entry = {
        x: from.x + (to.x - from.x) * amount,
        y: from.y + (to.y - from.y) * amount,
        z: stockSurface,
      };
    }
    cutCycleBaselineDepth = deepestPlateauByPoint.get(cutPointKey(entry)) ?? 0;
    cutCycleDeepestDepth = cutCycleBaselineDepth;
    cutCycleSawPlateau = false;
    cutCyclePlateaus = new Map<string, number>();
    cutCycleActive = true;
  };
  const recordCutSegment = (from: Point3, to: Point3, horizontalDistance: number) => {
    if (!cutCycleActive) beginCutCycle(from, to);
    const deepestDepth = Math.max(cutDepth(from), cutDepth(to));
    cutCycleDeepestDepth = Math.max(cutCycleDeepestDepth, deepestDepth);

    // Fusion and Vectric ramps settle onto a constant-Z cutting plateau for
    // each pass. Measuring the change between those plateaus avoids treating
    // new tab points introduced only on a deep contour as a full-depth plunge.
    const isCuttingPlateau = horizontalDistance > EPSILON && Math.abs(to.z - from.z) <= EPSILON;
    if (!isCuttingPlateau || deepestDepth <= EPSILON) return;
    cutCycleSawPlateau = true;
    for (const point of [from, to]) {
      const key = cutPointKey(point);
      cutCyclePlateaus.set(key, Math.max(cutCyclePlateaus.get(key) ?? 0, deepestDepth));
    }
  };

  const addSegment = (
    from: Point3,
    to: Point3,
    kind: "move" | "jog",
    line: number,
    source: string,
    arc = false,
  ) => {
    if (![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)) {
      unknown.add(`unresolved coordinate at line ${line}`);
      return;
    }
    const horizontalDistance = Math.hypot(to.x - from.x, to.y - from.y);
    const engaged = Math.min(from.z, to.z) < stockSurface - EPSILON;
    const feedIps = kind === "move" ? moveFeed : config.machine.jogSpeed.xy;
    const zFeedIps = kind === "move" ? plungeFeed : config.machine.jogSpeed.z;
    const durationFeed = horizontalDistance > EPSILON ? feedIps : zFeedIps;
    estimatedSeconds += durationFeed > EPSILON ? distance(from, to) / durationFeed : 0;
    const segment: ToolpathSegment = {
      from: { ...from }, to: { ...to }, kind, arc, engaged, line, feedIps, plungeIps: zFeedIps, rpm,
    };
    segments.push(segment);
    addPoint(programBounds, from);
    addPoint(programBounds, to);
    if (engaged && kind === "move") {
      addPoint(cuttingBounds, from);
      addPoint(cuttingBounds, to);
      if (!spindleRunning && !firstCutWithoutSpindle) firstCutWithoutSpindle = { line, source: source.trim() };
      recordCutSegment(from, to, horizontalDistance);
      if (to.z < from.z - EPSILON) {
        maxPlungeIps = Math.max(maxPlungeIps, zFeedIps);
      }
    }
    const jogEntersMaterial = kind === "jog" && engaged
      && (horizontalDistance > EPSILON || to.z < from.z - EPSILON);
    if (jogEntersMaterial) {
      rapidBelowSurfaceCount += 1;
      if (!firstRapidBelowSurface) firstRapidBelowSurface = { line, source: source.trim() };
    }
    if (kind === "move") moveCount += 1;
    else jogCount += 1;
    if (to.z >= stockSurface - EPSILON) finishCutCycle();
  };

  let mainProgramEnded = false;
  for (let index = 0; index < sourceLines.length; index += 1) {
    const rawLine = sourceLines[index];
    const lineNumber = index + 1;
    const code = stripComment(rawLine);
    if (!code || mainProgramEnded) continue;

    if (/^[A-Za-z_][A-Za-z0-9_]*:$/.test(code)) continue;
    if (/^IF\s+/i.test(code)) {
      commandCount += 1;
      if (!/^IF\s+%\(25\)\s*=\s*[01]\s+THEN\s+GOTO\s+UNIT_ERROR$/i.test(code)) unknown.add("IF/GOTO");
      continue;
    }
    if (code.startsWith("&")) {
      const assignment = code.match(/^(&[A-Za-z0-9_]+)\s*=\s*(.+)$/);
      if (assignment) {
        const numeric = Number.parseFloat(assignment[2]);
        variables.set(assignment[1].toLowerCase(), Number.isFinite(numeric) ? numeric : assignment[2].trim());
      } else {
        unknown.add("variable expression");
      }
      continue;
    }

    const command = code.split(/[\s,]+/, 1)[0].toUpperCase();
    const args = code.split(",").slice(1).map((value) => value.trim());
    commandCount += 1;

    if (command === "END") {
      mainProgramEnded = true;
      continue;
    }
    if (command === "SA") {
      sawAbsolute = true;
      continue;
    }
    if (command === "CN") {
      const customNumber = Number.parseInt(args[0] ?? "", 10);
      if (![90, 91].includes(customNumber)) unknown.add(`CN ${Number.isFinite(customNumber) ? customNumber : "?"}`);
      continue;
    }
    if (command === "C6") {
      spindleRunning = true;
      spindleStarted = true;
      continue;
    }
    if (command === "C7") {
      spindleRunning = false;
      spindleStopped = true;
      continue;
    }
    if (command === "C9") continue;
    if (command === "TR") {
      const parsed = Number.parseFloat(args[0] ?? "");
      if (Number.isFinite(parsed)) rpm = parsed;
      else unknown.add("TR expression");
      continue;
    }
    if (command === "MS") {
      const xy = Number.parseFloat(args[0] ?? "");
      const z = Number.parseFloat(args[1] ?? "");
      if (Number.isFinite(xy)) moveFeed = xy * scale;
      else unknown.add("MS expression");
      if (Number.isFinite(z)) plungeFeed = z * scale;
      sawMoveSpeed = true;
      continue;
    }
    if (command === "PAUSE") continue;
    if (command === "SF") {
      const enabled = Number.parseInt(args[0] ?? "", 10);
      if (enabled === 0) {
        issues.push(issue("error", "setup", "limit-check-disabled", "File disables machine limit checking", "SF,0 turns off ShopBot’s software move-limit check during the program.", {
          line: lineNumber, source: rawLine.trim(), recommendation: "Remove SF,0 and keep limit checking enabled.",
        }));
      }
      continue;
    }
    if (GLOBAL_SETTING_COMMANDS.has(command)) {
      issues.push(issue("warning", "setup", `global-${command.toLowerCase()}-${lineNumber}`, `${command} changes machine-wide setup`, "This command changes calibration, limits, inputs, units, or the coordinate base and is not expected in an ordinary part file.", {
        line: lineNumber, source: rawLine.trim(), recommendation: "Verify this command against the machine backup before running the file.",
      }));
      unknown.add(command);
      continue;
    }
    if (["SR", "VS", "JS", "VR"].includes(command)) {
      unknown.add(command);
      continue;
    }

    const from = { ...position };
    if (command === "JZ") {
      position = { ...position, z: numberArg(args[0], scale, position.z) };
      addSegment(from, position, "jog", lineNumber, rawLine);
      continue;
    }
    if (command === "J2" || command === "M2") {
      position = {
        ...position,
        x: numberArg(args[0], scale, position.x),
        y: numberArg(args[1], scale, position.y),
      };
      addSegment(from, position, command === "J2" ? "jog" : "move", lineNumber, rawLine);
      continue;
    }
    if (command === "J3" || command === "M3") {
      position = {
        x: numberArg(args[0], scale, position.x),
        y: numberArg(args[1], scale, position.y),
        z: numberArg(args[2], scale, position.z),
      };
      addSegment(from, position, command === "J3" ? "jog" : "move", lineNumber, rawLine);
      continue;
    }
    if (command === "CG") {
      const end: Point3 = {
        x: numberArg(args[1], scale, position.x),
        y: numberArg(args[2], scale, position.y),
        z: position.z,
      };
      const offsetX = numberArg(args[3], scale, Number.NaN);
      const offsetY = numberArg(args[4], scale, Number.NaN);
      const direction = Number.parseFloat(args[6] || args[7] || "1");
      if (![end.x, end.y, offsetX, offsetY].every(Number.isFinite)) {
        unknown.add(`CG expression at line ${lineNumber}`);
        continue;
      }
      const center = { x: position.x + offsetX, y: position.y + offsetY };
      const radius = Math.hypot(position.x - center.x, position.y - center.y);
      const startAngle = Math.atan2(position.y - center.y, position.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
      let sweep = endAngle - startAngle;
      if (direction < 0) {
        while (sweep <= EPSILON) sweep += Math.PI * 2;
      } else {
        while (sweep >= -EPSILON) sweep -= Math.PI * 2;
      }
      const steps = Math.max(4, Math.min(96, Math.ceil(Math.abs(sweep) / (Math.PI / 24))));
      let arcPosition = { ...position };
      for (let step = 1; step <= steps; step += 1) {
        const angle = startAngle + sweep * (step / steps);
        const next = step === steps ? end : { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius, z: position.z };
        addSegment(arcPosition, next, "move", lineNumber, rawLine, true);
        arcPosition = { ...next };
      }
      position = end;
      arcCount += 1;
      continue;
    }

    if (!KNOWN_COMMANDS.has(command)) unknown.add(command || `line ${lineNumber}`);
  }

  finishCutCycle();

  const bounds = finiteBounds(programBounds);
  const cutBounds = Number.isFinite(cuttingBounds.minX) ? finiteBounds(cuttingBounds) : null;
  // File metadata is copied into the editable cutter configuration when a file
  // is loaded. From that point on, the configuration is the source of truth so
  // an operator can correct or intentionally override the embedded values.
  const cutterDiameter = config.cutter.diameter;
  const cutterFlutes = config.cutter.flutes;
  const cutterRadius = cutterDiameter / 2;
  const stockZeroRange = cutBounds ? {
    x: {
      min: effectiveStock.x - cutterRadius - cutBounds.minX,
      max: effectiveStock.x + effectiveStock.width + cutterRadius - cutBounds.maxX,
    },
    y: {
      min: effectiveStock.y - cutterRadius - cutBounds.minY,
      max: effectiveStock.y + effectiveStock.height + cutterRadius - cutBounds.maxY,
    },
  } : null;
  const zeroRange = {
    x: { min: config.machine.limits.x.min - bounds.minX, max: config.machine.limits.x.max - bounds.maxX },
    y: { min: config.machine.limits.y.min - bounds.minY, max: config.machine.limits.y.max - bounds.maxY },
    stock: stockZeroRange,
  };

  if (metadata.unitsSource === "machine-default") {
    issues.push(issue("warning", "setup", "units-inferred", "File units are not declared", `Coordinates were interpreted as ${metadata.units === "in" ? "inches" : "millimeters"} from the machine profile.`, {
      recommendation: "Add a standard unit guard or unit header to the postprocessor output.",
    }));
  } else if (metadata.units === "mm") {
    issues.push(issue("error", "setup", "metric-units", "File requires metric mode", metadata.unitsSource === "unit-guard"
      ? "The ShopBot unit guard requires millimeter mode before movement. EBMC’s PRSalpha workflow is configured for inches."
      : "The file declares millimeter coordinates. EBMC’s PRSalpha workflow is configured for inches.", {
      recommendation: "Repost the job from CAM with inches selected. Do not remove the guard or run these coordinates on the inch-configured machine.",
    }));
  } else {
    issues.push(issue("pass", "setup", "inch-units", "File uses inches", metadata.unitsSource === "unit-guard"
      ? "The ShopBot unit guard requires inch mode before movement."
      : "The file declares inch coordinates."));
  }
  if (!sawAbsolute) {
    issues.push(issue("error", "setup", "absolute-mode-missing", "Absolute coordinate mode is not established", "The statically analyzable profile requires SA before movement begins.", {
      recommendation: "Add SA near the beginning of the part file.",
    }));
  }
  if (!sawMoveSpeed) {
    issues.push(issue("warning", "cut-load", "move-speed-missing", "No MS feed setting was found", "The file relies on the ShopBot console’s existing move speeds.", {
      recommendation: "Set an explicit XY and Z move speed in the file.",
    }));
  }
  if (rpm === null) {
    issues.push(issue("warning", "cut-load", "rpm-missing", "No spindle RPM was found", "Chip load cannot be checked without a TR spindle-speed command.", {
      recommendation: "Add TR or enter the intended spindle speed before relying on feed analysis.",
    }));
  } else if (rpm < config.machine.spindle.minRpm || rpm > config.machine.spindle.maxRpm) {
    issues.push(issue("error", "cut-load", "rpm-range", "Spindle RPM is outside the configured range", `${rpm.toLocaleString()} RPM is outside ${config.machine.spindle.minRpm.toLocaleString()}–${config.machine.spindle.maxRpm.toLocaleString()} RPM.`, {
      recommendation: "Correct TR or verify the spindle’s rated range.",
    }));
  }
  if (firstCutWithoutSpindle) {
    issues.push(issue("error", "setup", "cut-without-spindle", "A cutting move occurs before spindle-on", "An engaged M move was found before the C6 spindle-on macro.", {
      line: firstCutWithoutSpindle.line, source: firstCutWithoutSpindle.source, recommendation: "Start the spindle and allow it to reach speed before plunging.",
    }));
  }
  if (spindleStarted && !spindleStopped) {
    issues.push(issue("warning", "setup", "spindle-not-stopped", "The file does not stop the spindle", "C6 starts the spindle, but no C7 spindle-off macro was found before END.", {
      recommendation: "Add C7 before the program ends.",
    }));
  }
  if (rapidBelowSurfaceCount > 0 && firstRapidBelowSurface) {
    issues.push(issue("error", "bounds", "rapid-in-stock", `${rapidBelowSurfaceCount} jog ${rapidBelowSurfaceCount === 1 ? "move enters" : "moves enter"} the stock`, "J moves use rapid speed and should remain above the modeled stock surface.", {
      line: firstRapidBelowSurface.line, source: firstRapidBelowSurface.source, recommendation: "Raise to a verified safe Z before repositioning.",
    }));
  }

  const machineMinX = bounds.minX + config.workOffset.x;
  const machineMaxX = bounds.maxX + config.workOffset.x;
  const machineMinY = bounds.minY + config.workOffset.y;
  const machineMaxY = bounds.maxY + config.workOffset.y;
  const outsideX = machineMinX < config.machine.limits.x.min - EPSILON || machineMaxX > config.machine.limits.x.max + EPSILON;
  const outsideY = machineMinY < config.machine.limits.y.min - EPSILON || machineMaxY > config.machine.limits.y.max + EPSILON;
  if (zeroRange.x.min > zeroRange.x.max || zeroRange.y.min > zeroRange.y.max) {
    issues.push(issue("error", "bounds", "path-too-large", "Toolpath is larger than the machine envelope", "No XY zero position can place every movement inside the configured machine limits."));
  } else if (outsideX || outsideY) {
    issues.push(issue("error", "bounds", "current-zero-outside", "Work zero places movement outside machine travel", `With machine X at work zero set to ${formatInches(config.workOffset.x)} and Y set to ${formatInches(config.workOffset.y)}, the tool center reaches ${formatInches(machineMinX)}…${formatInches(machineMaxX)} X and ${formatInches(machineMinY)}…${formatInches(machineMaxY)} Y.`, {
      recommendation: `Place work zero at machine X ${formatInches(zeroRange.x.min)}…${formatInches(zeroRange.x.max)} and Y ${formatInches(zeroRange.y.min)}…${formatInches(zeroRange.y.max)}.`,
    }));
  } else {
    issues.push(issue("pass", "bounds", "machine-envelope", "Toolpath fits machine travel", `At the entered work zero, the tool center stays within the configured X and Y travel limits.`));
  }
  if ((bounds.minX < -EPSILON || bounds.minY < -EPSILON) && !outsideX && !outsideY) {
    issues.push(issue("pass", "bounds", "negative-coordinates-positioned", "Negative coordinates are safely positioned", `The file reaches X ${formatInches(bounds.minX)} and Y ${formatInches(bounds.minY)} relative to work zero, but the entered machine position keeps those moves inside machine travel.`));
  }
  if (cutBounds && stockZeroRange) {
    const cutCenterMinX = cutBounds.minX + config.workOffset.x;
    const cutCenterMaxX = cutBounds.maxX + config.workOffset.x;
    const cutCenterMinY = cutBounds.minY + config.workOffset.y;
    const cutCenterMaxY = cutBounds.maxY + config.workOffset.y;
    const allowedMinX = effectiveStock.x - cutterRadius;
    const allowedMaxX = effectiveStock.x + effectiveStock.width + cutterRadius;
    const allowedMinY = effectiveStock.y - cutterRadius;
    const allowedMaxY = effectiveStock.y + effectiveStock.height + cutterRadius;
    const stockOutside = cutCenterMinX < allowedMinX - EPSILON
      || cutCenterMinY < allowedMinY - EPSILON
      || cutCenterMaxX > allowedMaxX + EPSILON
      || cutCenterMaxY > allowedMaxY + EPSILON;
    const fitsStock = stockZeroRange.x.min <= stockZeroRange.x.max
      && stockZeroRange.y.min <= stockZeroRange.y.max;
    if (!fitsStock) {
      issues.push(issue("warning", "bounds", "stock-envelope-too-large", "Cutting path is larger than the stock allowance", `No work-zero position can fit the tool centerline within the ${formatInches(effectiveStock.width)} × ${formatInches(effectiveStock.height)} stock plus ${formatInches(cutterRadius)} of cutter-radius overhang on each edge.`, {
        recommendation: "Confirm the stock position and dimensions, cutter diameter, and whether the cut intentionally exceeds the stock by more than one cutter radius.",
      }));
    } else if (stockOutside) {
      issues.push(issue("warning", "bounds", "stock-envelope", "Cutting path exceeds the stock overhang allowance", `The tool center reaches machine X ${formatInches(cutCenterMinX)}…${formatInches(cutCenterMaxX)} and Y ${formatInches(cutCenterMinY)}…${formatInches(cutCenterMaxY)}. The modeled stock plus ${formatInches(cutterRadius)} of cutter-radius overhang allows X ${formatInches(allowedMinX)}…${formatInches(allowedMaxX)} and Y ${formatInches(allowedMinY)}…${formatInches(allowedMaxY)}.`, {
        recommendation: `Place work zero at machine X ${formatInches(stockZeroRange.x.min)}…${formatInches(stockZeroRange.x.max)} and Y ${formatInches(stockZeroRange.y.min)}…${formatInches(stockZeroRange.y.max)}, or correct the stock rectangle.`,
      }));
    } else {
      issues.push(issue("pass", "bounds", "stock-envelope", "Cutting path stays within the stock allowance", `The tool center stays within the modeled stock or no more than ${formatInches(cutterRadius)}—half the cutter diameter—beyond an edge.`));
    }
  }
  const zTravel = bounds.maxZ - bounds.minZ;
  const machineZTravel = config.machine.limits.z.max - config.machine.limits.z.min;
  if (zTravel > machineZTravel + EPSILON) {
    issues.push(issue("error", "bounds", "z-travel", "Programmed Z travel exceeds machine capacity", `${formatInches(zTravel)} of programmed Z motion exceeds the configured ${formatInches(machineZTravel)} span.`));
  }
  const tableBaseMinZ = effectiveStock.zOrigin === "top" ? bounds.minZ + effectiveStock.thickness : bounds.minZ;
  const tableBaseMaxZ = effectiveStock.zOrigin === "top" ? bounds.maxZ + effectiveStock.thickness : bounds.maxZ;
  if (tableBaseMinZ < config.machine.limits.z.min - EPSILON || tableBaseMaxZ > config.machine.limits.z.max + EPSILON) {
    issues.push(issue("error", "bounds", "z-envelope", "Programmed Z position exceeds machine limits", `With ${effectiveStock.zOrigin === "top" ? "stock-surface" : "table-surface"} Z zero, movement maps to table-base Z ${formatInches(tableBaseMinZ)}…${formatInches(tableBaseMaxZ)}.`, {
      recommendation: "Confirm stock thickness and the Z-zero convention before running the file.",
    }));
  }
  if (bounds.minZ < stockBottom - config.spoilboardAllowance - EPSILON) {
    const overcut = stockBottom - bounds.minZ;
    issues.push(issue(overcut > 0.25 ? "error" : "warning", "bounds", "spoilboard-depth", "Cut extends beneath the allowed stock depth", `The lowest Z is ${formatInches(overcut)} below the modeled stock bottom; allowance is ${formatInches(config.spoilboardAllowance)}.`, {
      recommendation: "Confirm stock thickness, Z-zero convention, and intended spoilboard cut-through.",
    }));
  }

  if (!metadata.toolName) {
    issues.push(issue("warning", "tooling", "tool-unidentified", `Confirm Tool ${metadata.toolNumber ?? "selection"}`, `The file does not identify cutter geometry; analysis is using ${config.cutter.name}.`, {
      recommendation: "Select the cutter actually installed before relying on load or cutter-envelope checks.",
    }));
  } else if (
    (metadata.toolDiameter !== null && Math.abs(metadata.toolDiameter - config.cutter.diameter) > 0.001)
    || (metadata.toolFlutes !== null && metadata.toolFlutes !== config.cutter.flutes)
  ) {
    issues.push(issue("info", "tooling", "tool-operator-override", "Job setup overrides cutter metadata", `The file identifies ${metadata.toolName}, but cutter checks use the diameter and flute count shown in Job setup.`));
  }

  const engagedHorizontal = segments.filter((segment) => segment.kind === "move" && segment.engaged && Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) > EPSILON);
  const maxFeedIps = engagedHorizontal.length ? Math.max(...engagedHorizontal.map((segment) => segment.feedIps)) : null;
  const maximumDepth = Math.max(0, stockSurface - bounds.minZ);
  const passRatio = cutterDiameter > EPSILON ? maxPassDepth / cutterDiameter : 0;
  const depthModifier = passRatio <= 1 ? 1 : passRatio >= 3 ? 0.5 : 1 - (passRatio - 1) * 0.25;
  const adjustedRange = {
    min: config.cutter.chipLoad.min * effectiveStock.chipLoadFactor * depthModifier,
    max: config.cutter.chipLoad.max * effectiveStock.chipLoadFactor * depthModifier,
  };
  const chipLoadSamples = engagedHorizontal
    .filter((segment) => segment.rpm && segment.rpm > 0 && cutterFlutes > 0)
    .map((segment) => ({
      chipLoad: segment.feedIps * 60 / ((segment.rpm as number) * cutterFlutes),
      rpm: segment.rpm as number,
    }));
  const maxChipLoadSample = chipLoadSamples.reduce<(typeof chipLoadSamples)[number] | null>(
    (maximum, sample) => !maximum || sample.chipLoad > maximum.chipLoad ? sample : maximum,
    null,
  );
  const maxChipLoad = maxChipLoadSample?.chipLoad ?? null;
  const targetFeedRange = maxChipLoadSample ? {
    min: adjustedRange.min * maxChipLoadSample.rpm * cutterFlutes,
    max: adjustedRange.max * maxChipLoadSample.rpm * cutterFlutes,
  } : null;
  const targetFeedText = targetFeedRange
    ? `A calculated starting band is ${Math.round(targetFeedRange.min)}–${Math.round(targetFeedRange.max)} ipm at ${maxChipLoadSample?.rpm.toLocaleString()} RPM.`
    : "";

  if (maxChipLoad !== null) {
    if (maxChipLoad > adjustedRange.max * 1.15) {
      issues.push(issue("error", "cut-load", "chip-load-high", "Calculated chip load is above the starting range", `${maxChipLoad.toFixed(4)}″/tooth exceeds the adjusted ${adjustedRange.min.toFixed(4)}–${adjustedRange.max.toFixed(4)}″/tooth range.`, {
        recommendation: `${targetFeedText} Reduce feed, reduce pass depth, increase RPM within the cutter’s rating, or use manufacturer guidance.`,
      }));
    } else if (maxChipLoad < adjustedRange.min * 0.55) {
      issues.push(issue("warning", "cut-load", "chip-load-low", "Calculated chip load is very low", `${maxChipLoad.toFixed(4)}″/tooth is below the adjusted ${adjustedRange.min.toFixed(4)}–${adjustedRange.max.toFixed(4)}″/tooth starting range and may create heat or rubbing.`, {
        recommendation: `${targetFeedText} Confirm the cutter, then consider increasing feed or reducing RPM.`,
      }));
    } else {
      issues.push(issue("pass", "cut-load", "chip-load-pass", "Chip load is within the starting range", `${maxChipLoad.toFixed(4)}″/tooth falls within the depth-adjusted starting band.`));
    }
  }
  if (passRatio > 3) {
    issues.push(issue("error", "cut-load", "pass-depth-extreme", "Pass depth exceeds three cutter diameters", `${formatInches(maxPassDepth)} is ${passRatio.toFixed(1)}× the modeled cutter diameter.`, {
      recommendation: `Start with passes no deeper than ${formatInches(cutterDiameter)} unless the cutter manufacturer allows more, then recalculate chip load.`,
    }));
  } else if (passRatio > 1) {
    issues.push(issue("warning", "cut-load", "pass-depth-deep", "Pass depth exceeds one cutter diameter", `${formatInches(maxPassDepth)} is ${passRatio.toFixed(1)}× the modeled cutter diameter; the chip-load range was reduced accordingly.`, {
      recommendation: `Start with passes no deeper than ${formatInches(cutterDiameter)} unless the cutter manufacturer allows more.`,
    }));
  }
  if (maxFeedIps && maxPlungeIps > Math.max(1, maxFeedIps * 0.55)) {
    issues.push(issue("warning", "cut-load", "plunge-fast", "Plunge speed is high relative to cutting feed", `${(maxPlungeIps * 60).toFixed(0)} ipm plunge is more than half the maximum cutting feed.`, {
      recommendation: `As a conservative heuristic, consider ${Math.round(maxFeedIps * 60 * 0.35)} ipm or less for plunges unless the cutter manufacturer specifies otherwise.`,
    }));
  }

  const unknownCommands = [...unknown].sort();
  if (unknownCommands.length) {
    issues.push(issue("error", "parser", "unsupported-commands", "Analysis is incomplete", `Unsupported or unresolved constructs: ${unknownCommands.join(", ")}.`, {
      recommendation: "Review these lines manually; this file cannot receive a complete static-analysis result.",
    }));
  } else {
    issues.push(issue("pass", "parser", "static-complete", "All commands were statically resolved", `${commandCount.toLocaleString()} commands fit the supported sample-driven OpenSBP profile.`));
  }
  if (!rapidBelowSurfaceCount) issues.push(issue("pass", "bounds", "rapid-clear", "Jog moves stay above the stock", "No rapid positioning move entered the modeled material."));
  if (spindleStarted && spindleStopped && !firstCutWithoutSpindle) issues.push(issue("pass", "setup", "spindle-sequence", "Spindle sequence is complete", "The spindle starts before engaged moves and stops before the program ends."));

  issues.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  const score = Math.max(0, 100 - issues.reduce((sum, item) => sum + severityWeight(item.severity), 0));

  return {
    filename,
    complete: unknownCommands.length === 0,
    score,
    lineCount: sourceLines.length,
    commandCount,
    unknownCommands,
    segments,
    bounds,
    cutBounds,
    metadata,
    effectiveStock,
    issues,
    stats: {
      moveCount,
      jogCount,
      arcCount,
      engagedMoveCount: engagedHorizontal.length,
      estimatedSeconds,
      rpm,
      maxFeedIpm: maxFeedIps === null ? null : maxFeedIps * 60,
      maxPlungeIpm: maxPlungeIps ? maxPlungeIps * 60 : null,
      chipLoad: maxChipLoad,
      adjustedChipLoadRange: rpm === null ? null : adjustedRange,
      maxPassDepth,
      maximumDepth,
    },
    zeroRange,
  };
}
