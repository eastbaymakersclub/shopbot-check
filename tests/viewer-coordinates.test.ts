import { describe, expect, it } from "vitest";
import { mapShopBotPoint, mapShopBotY } from "../lib/viewer-coordinates";

describe("ShopBot viewer coordinates", () => {
  it("preserves the right-handed ShopBot axes in the Three.js scene", () => {
    expect(mapShopBotPoint({ x: 1, y: 2, z: 3 }, { x: 0, y: 0 })).toEqual([1, 3, -2]);
  });

  it("applies table-base work offsets before mapping Y into scene depth", () => {
    expect(mapShopBotPoint({ x: 1, y: 2, z: 3 }, { x: 4, y: 5 })).toEqual([5, 3, -7]);
    expect(mapShopBotY(2, 5)).toBe(-7);
  });
});
