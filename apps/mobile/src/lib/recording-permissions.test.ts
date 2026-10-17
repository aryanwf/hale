import { describe, expect, mock, test } from "bun:test";
import { requestAndroidRecordingPermissions } from "./recording-permissions";

function allowedPermissions(apiLevel: number) {
  return {
    apiLevel,
    requestMicrophone: mock(async () => ({ granted: true })),
    requestNotifications: mock(async () => ({ granted: true })),
  };
}

describe("Android recording permissions", () => {
  test("Android 13 requests microphone access before notification access", async () => {
    const requested: string[] = [];
    await requestAndroidRecordingPermissions({
      apiLevel: 33,
      requestMicrophone: async () => { requested.push("microphone"); return { granted: true }; },
      requestNotifications: async () => { requested.push("notifications"); return { granted: true }; },
    });
    expect(requested).toEqual(["microphone", "notifications"]);
  });

  test("Android 12 does not request the Android 13 notification permission", async () => {
    const permissions = allowedPermissions(32);
    await requestAndroidRecordingPermissions(permissions);
    expect(permissions.requestNotifications).not.toHaveBeenCalled();
  });

  test("newer Android versions still request notification permission", async () => {
    const permissions = allowedPermissions(36);
    await requestAndroidRecordingPermissions(permissions);
    expect(permissions.requestNotifications).toHaveBeenCalledTimes(1);
  });

  test("microphone denial explains how to enable access", async () => {
    const permissions = { ...allowedPermissions(33), requestMicrophone: async () => ({ granted: false }) };
    await expect(requestAndroidRecordingPermissions(permissions)).rejects.toThrow("Microphone access is off");
  });

  test("microphone denial does not prompt for unrelated notification access", async () => {
    const permissions = { ...allowedPermissions(33), requestMicrophone: async () => ({ granted: false }) };
    await requestAndroidRecordingPermissions(permissions).catch(() => undefined);
    expect(permissions.requestNotifications).not.toHaveBeenCalled();
  });

  test("notification denial prevents background recording and explains the requirement", async () => {
    const permissions = { ...allowedPermissions(33), requestNotifications: async () => ({ granted: false }) };
    await expect(requestAndroidRecordingPermissions(permissions)).rejects.toThrow("Notifications are off");
  });

  test("native permission errors propagate to the caller", async () => {
    const permissions = { ...allowedPermissions(33), requestMicrophone: async () => { throw new Error("Permission service unavailable"); } };
    await expect(requestAndroidRecordingPermissions(permissions)).rejects.toThrow("Permission service unavailable");
  });
});
