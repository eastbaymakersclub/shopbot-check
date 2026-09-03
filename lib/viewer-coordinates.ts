import type { Point3 } from "./sbp";

export interface WorkOffset2D {
  x: number;
  y: number;
}

interface XYLimits {
  x: { min: number; max: number };
  y: { min: number; max: number };
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

export function segmentExceedsMachineTravel(
  from: Point3,
  to: Point3,
  workOffset: WorkOffset2D,
  limits: XYLimits,
): boolean {
  const fromX = from.x + workOffset.x;
  const toX = to.x + workOffset.x;
  const fromY = from.y + workOffset.y;
  const toY = to.y + workOffset.y;
  return Math.min(fromX, toX) < limits.x.min
    || Math.max(fromX, toX) > limits.x.max
    || Math.min(fromY, toY) < limits.y.min
    || Math.max(fromY, toY) > limits.y.max;
}
