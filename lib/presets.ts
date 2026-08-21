import type { AnalysisConfig, CutterPreset, MachineProfile, StockConfig } from "./sbp";

export const EBMC_PRS_ALPHA: MachineProfile = {
  id: "ebmc-prsalpha-96x48",
  name: "EBMC PRSalpha 96 × 48",
  units: "in",
  limits: {
    x: { min: -0.5, max: 96.5 },
    y: { min: -0.5, max: 48.5 },
    z: { min: -2, max: 8 },
  },
  moveSpeed: { xy: 4, z: 1 },
  jogSpeed: { xy: 12, z: 4 },
  spindle: { minRpm: 8000, maxRpm: 24000 },
};

export const CUTTER_PRESETS: CutterPreset[] = [
  {
    id: "half-compression-2f",
    name: "½″ compression · 2 flute",
    diameter: 0.5,
    flutes: 2,
    geometry: "compression",
    chipLoad: { min: 0.007, max: 0.009 },
    source: "ShopBot plywood starting range",
  },
  {
    id: "three-eighths-compression-2f",
    name: "⅜″ compression · 2 flute",
    diameter: 0.375,
    flutes: 2,
    geometry: "compression",
    chipLoad: { min: 0.006, max: 0.008 },
    source: "Conservative plywood starting range",
  },
  {
    id: "quarter-ball-2f",
    name: "¼″ ball nose · 2 flute",
    diameter: 0.25,
    flutes: 2,
    geometry: "ball-nose",
    chipLoad: { min: 0.005, max: 0.007 },
    observed: { rpm: 10000, feedIpm: 120, plungeIpm: 40 },
    source: "EBMC Vectric sample corpus",
  },
  {
    id: "eighth-flat-2f",
    name: "⅛″ flat end mill · 2 flute",
    diameter: 0.125,
    flutes: 2,
    geometry: "flat",
    chipLoad: { min: 0.003, max: 0.005 },
    observed: { rpm: 10000, feedIpm: 65, plungeIpm: 20 },
    source: "EBMC Vectric sample corpus",
  },
  {
    id: "eighth-ball-2f",
    name: "⅛″ ball nose · 2 flute",
    diameter: 0.125,
    flutes: 2,
    geometry: "ball-nose",
    chipLoad: { min: 0.003, max: 0.005 },
    observed: { rpm: 10000, feedIpm: 65, plungeIpm: 20 },
    source: "EBMC Vectric sample corpus",
  },
];

export const STOCK_PRESETS: Array<StockConfig & { id: string; name: string }> = [
  {
    id: "soft-plywood",
    name: "Soft plywood",
    material: "Soft plywood",
    thickness: 0.7,
    width: 96,
    height: 48,
    zOrigin: "top",
    chipLoadFactor: 1,
  },
  {
    id: "hardwood",
    name: "Hardwood",
    material: "Hardwood",
    thickness: 0.75,
    width: 48,
    height: 24,
    zOrigin: "top",
    chipLoadFactor: 0.9,
  },
  {
    id: "mdf",
    name: "MDF",
    material: "MDF",
    thickness: 0.75,
    width: 96,
    height: 48,
    zOrigin: "top",
    chipLoadFactor: 0.95,
  },
];

export const DEFAULT_CONFIG: AnalysisConfig = {
  machine: EBMC_PRS_ALPHA,
  stock: STOCK_PRESETS[0],
  cutter: CUTTER_PRESETS[0],
  workOffset: { x: 0, y: 0 },
  spoilboardAllowance: 0.05,
};
