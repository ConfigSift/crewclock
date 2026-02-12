// ─── Haversine Distance (meters) ─────────────────────
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Get Current Position (promisified) ──────────────
export function getCurrentPosition(
  options?: PositionOptions
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
      ...options,
    });
  });
}

export type GeoStatus =
  | "idle"
  | "checking"
  | "on_site"
  | "too_far"
  | "denied"
  | "error";

export interface GeoCheckResult {
  status: GeoStatus;
  distance: number | null;
  coords: { lat: number; lng: number } | null;
  error?: string;
}

// ─── Check if user is near a project ─────────────────
export async function checkProximity(
  projectLat: number,
  projectLng: number,
  radiusMeters: number
): Promise<GeoCheckResult> {
  try {
    const pos = await getCurrentPosition();
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const distance = haversineDistance(lat, lng, projectLat, projectLng);

    return {
      status: distance <= radiusMeters ? "on_site" : "too_far",
      distance: Math.round(distance),
      coords: { lat, lng },
    };
  } catch (err: unknown) {
    const geoErr = err as GeolocationPositionError;
    if (geoErr?.code === 1) {
      return { status: "denied", distance: null, coords: null, error: "Location access denied" };
    }
    return { status: "error", distance: null, coords: null, error: "Could not determine location" };
  }
}

export const DEFAULT_GEO_RADIUS = Number(
  process.env.NEXT_PUBLIC_DEFAULT_GEO_RADIUS || 300
);
