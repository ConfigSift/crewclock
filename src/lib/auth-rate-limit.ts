import "server-only";

type LimitRecord = {
  count: number;
  windowStart: number;
  lockedUntil: number;
};

type RateLimitStore = Map<string, LimitRecord>;

type GlobalRateLimit = typeof globalThis & {
  __crewclock_employee_login_rate_limit__?: RateLimitStore;
};

const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function getStore(): RateLimitStore {
  const globalRateLimit = globalThis as GlobalRateLimit;
  if (!globalRateLimit.__crewclock_employee_login_rate_limit__) {
    globalRateLimit.__crewclock_employee_login_rate_limit__ = new Map();
  }

  return globalRateLimit.__crewclock_employee_login_rate_limit__;
}

export type LimitStatus =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

function evaluateKey(key: string, now: number): LimitStatus {
  const record = getStore().get(key);
  if (!record) {
    return { allowed: true };
  }

  if (record.lockedUntil > now) {
    return { allowed: false, retryAfterMs: record.lockedUntil - now };
  }

  return { allowed: true };
}

function recordFailureKey(key: string, now: number): LimitStatus {
  const store = getStore();
  const current = store.get(key);

  if (!current || now - current.windowStart >= WINDOW_MS) {
    store.set(key, {
      count: 1,
      windowStart: now,
      lockedUntil: 0,
    });
    return { allowed: true };
  }

  if (current.lockedUntil > now) {
    return { allowed: false, retryAfterMs: current.lockedUntil - now };
  }

  const nextCount = current.count + 1;
  if (nextCount >= MAX_ATTEMPTS) {
    const lockedUntil = now + LOCK_MS;
    store.set(key, {
      count: nextCount,
      windowStart: current.windowStart,
      lockedUntil,
    });
    return { allowed: false, retryAfterMs: LOCK_MS };
  }

  store.set(key, {
    count: nextCount,
    windowStart: current.windowStart,
    lockedUntil: 0,
  });

  return { allowed: true };
}

function clearKey(key: string): void {
  getStore().delete(key);
}

function ipKey(ip: string): string {
  return `ip:${ip || "unknown"}`;
}

function phoneKey(phone: string): string {
  return `phone:${phone}`;
}

export function getEmployeeLoginLimit(ip: string, phone: string): LimitStatus {
  const now = Date.now();
  const ipStatus = evaluateKey(ipKey(ip), now);
  const phoneStatus = evaluateKey(phoneKey(phone), now);

  if (ipStatus.allowed && phoneStatus.allowed) {
    return { allowed: true };
  }

  const retryAfterMs = Math.max(
    ipStatus.allowed ? 0 : ipStatus.retryAfterMs,
    phoneStatus.allowed ? 0 : phoneStatus.retryAfterMs
  );

  return { allowed: false, retryAfterMs };
}

export function recordEmployeeLoginFailure(ip: string, phone: string): LimitStatus {
  const now = Date.now();
  const ipStatus = recordFailureKey(ipKey(ip), now);
  const phoneStatus = recordFailureKey(phoneKey(phone), now);

  if (ipStatus.allowed && phoneStatus.allowed) {
    return { allowed: true };
  }

  const retryAfterMs = Math.max(
    ipStatus.allowed ? 0 : ipStatus.retryAfterMs,
    phoneStatus.allowed ? 0 : phoneStatus.retryAfterMs
  );

  return { allowed: false, retryAfterMs };
}

export function clearEmployeeLoginFailures(ip: string, phone: string): void {
  clearKey(ipKey(ip));
  clearKey(phoneKey(phone));
}
