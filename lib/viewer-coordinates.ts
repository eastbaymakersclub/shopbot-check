import type { Point3 } from "./sbp";

export interface WorkOffset2D {
  x: number;
  y: number;
}

/**
 * Map ShopBot's right-handed X/Y/Z coordinates into Three.js, where Y is up.
 * Negating ShopBot Y preserves handedness after moving ShopBot Z onto Three Y.
 */
export function mapShopBotPoint(point: Point3, workOffset: WorkOffset2D): [number, number, number] {
  return [point.x + workOffset.x, point.z, mapShopBotY(point.y, workOffset.y)];
}

export function mapShopBotY(y: number, workOffsetY = 0): number {
  return -(y + workOffsetY);
}
