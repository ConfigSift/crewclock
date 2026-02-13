export function normalizePhone(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;

  const digits = input.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

export function isValidPasscode(passcode: string): boolean {
  return /^[0-9]{6}$/.test(passcode);
}

export function generatePasscode(): string {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}
