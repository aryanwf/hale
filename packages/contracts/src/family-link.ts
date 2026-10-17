const FAMILY_QR_PREFIX = "hale:family:v1:";
const FAMILY_CODE_PATTERN = /^[A-F0-9]{24}$/;

export function normalizeFamilyCode(value: string): string | null {
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  return FAMILY_CODE_PATTERN.test(code) ? code : null;
}

export function familyQrPayload(code: string): string {
  const normalized = normalizeFamilyCode(code);
  if (!normalized) throw new Error("Invalid family code.");
  return `${FAMILY_QR_PREFIX}${normalized}`;
}

export function readFamilyQr(payload: string): string | null {
  if (!payload.startsWith(FAMILY_QR_PREFIX)) return null;
  return normalizeFamilyCode(payload.slice(FAMILY_QR_PREFIX.length));
}
