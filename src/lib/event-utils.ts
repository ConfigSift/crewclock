import { haversineDistanceMeters } from "@/lib/geo";

type NullableNumber = number | null | undefined;

export function parseOccurredAt(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("occurred_at must be a valid ISO date string.");
  }

  return parsed.toISOString();
}

export function computeDistanceMeters(
  originLat: number,
  originLng: number,
  targetLat: number,
  targetLng: number
): number {
  return haversineDistanceMeters(originLat, originLng, targetLat, targetLng);
}

export function computeInsideGeofence(
  distanceMeters: number,
  radiusMeters: NullableNumber
): boolean {
  if (typeof radiusMeters !== "number" || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    return false;
  }
  return distanceMeters <= radiusMeters;
}

export function ensureFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return value;
}
