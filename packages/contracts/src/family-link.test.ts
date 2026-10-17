import { describe, expect, test } from "bun:test";
import { familyQrPayload, normalizeFamilyCode, readFamilyQr } from "./family-link";

const CODE = "1234ABCDEF567890ABCD1234";

describe("family QR pairing", () => {
  test("dashboard QR payload decodes to the same patient linking code", () => {
    expect(readFamilyQr(familyQrPayload(CODE))).toBe(CODE);
  });

  test("manually entered codes tolerate spaces, hyphens, and lowercase", () => {
    expect(normalizeFamilyCode(" 1234-abcd-ef56-7890-abcd-1234 ")).toBe(CODE);
  });

  test("payloads do not contain a web URL or send the secret to a QR service", () => {
    expect(familyQrPayload(CODE)).toBe(`hale:family:v1:${CODE}`);
  });

  test.each(["", "1234", "G".repeat(24), `${CODE}A`])("rejects invalid manual code %s", (value) => {
    expect(normalizeFamilyCode(value)).toBeNull();
  });

  test.each([CODE, `https://example.com/?code=${CODE}`, `hale:family:v2:${CODE}`, "hale:family:v1:bad", "", `other:family:v1:${CODE}`])("rejects unrelated or malformed QR data %s", (payload) => {
    expect(readFamilyQr(payload)).toBeNull();
  });

  test("never generates a QR payload for an invalid code", () => {
    expect(() => familyQrPayload("invalid")).toThrow("Invalid family code");
  });
});
