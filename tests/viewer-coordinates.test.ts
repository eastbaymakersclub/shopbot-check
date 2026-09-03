import { describe, expect, it } from "vitest";
import { mapShopBotPoint, mapShopBotY, segmentExceedsMachineTravel } from "../lib/viewer-coordinates";

describe("ShopBot viewer coordinates", () => {
  it("preserves the right-handed ShopBot axes in the Three.js scene", () => {
    expect(mapShopBotPoint({ x: 1, y: 2, z: 3 }, { x: 0, y: 0 })).toEqual([1, 3, -2]);
  });

  it("applies table-base work offsets before mapping Y into scene depth", () => {
    expect(mapShopBotPoint({ x: 1, y: 2, z: 3 }, { x: 4, y: 5 })).toEqual([5, 3, -7]);
    expect(mapShopBotY(2, 5)).toBe(-7);
  });

  it("colors only actual machine-travel violations after applying work zero", () => {
    const limits = { x: { min: -0.5, max: 96.5 }, y: { min: -0.5, max: 48.5 } };
    const origin = { x: 0, y: 0, z: 0 };

    expect(segmentExceedsMachineTravel(origin, { x: -0.25, y: -0.25, z: 0 }, { x: 0, y: 0 }, limits)).toBe(false);
    expect(segmentExceedsMachineTravel(origin, { x: -1, y: -0.75, z: 0 }, { x: 0, y: 0 }, limits)).toBe(true);
    expect(segmentExceedsMachineTravel(origin, { x: -1, y: -0.75, z: 0 }, { x: 1.25, y: 1 }, limits)).toBe(false);
  });
});
