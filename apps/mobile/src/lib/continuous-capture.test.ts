import { describe, expect, mock, test } from "bun:test";
import { ContinuousCaptureController, parseCaptureStatus, type NativeCapture, type NativeCaptureStatus } from "./continuous-capture";

function setup() {
  const status: NativeCaptureStatus = { recording: false, starting: false, uploading: false, pendingCount: 0, blockedByAnotherSpace: false, message: "" };
  const native: NativeCapture = {
    start: mock(async () => { status.recording = true; status.sessionId = "session"; }),
    stop: mock(async () => { status.recording = false; status.needsFinalization = true; }),
    status: async () => JSON.stringify(status),
    credentials: mock(async () => {}), discard: mock(async () => { status.pendingCount = 0; }), retryUploads: mock(async () => {}),
  };
  const backend = {
    requestPermissions: mock(async () => {}), beginSession: mock(async () => "session"),
    endSession: mock(async () => {}), uploadCredentials: mock(async () => ({ siteUrl: "https://example.convex.site", token: "test-token" })),
  };
  const controller = new ContinuousCaptureController({ native, owner: "owner", patientId: "patient", ...backend });
  return { status, native, backend, controller };
}

describe("continuous recording toggle", () => {
  test("never starts the microphone without consent", async () => {
    const { controller, native } = setup();
    await controller.start(false);
    expect(native.start).not.toHaveBeenCalled();
  });

  test("denied permissions never create a session", async () => {
    const { controller, backend } = setup();
    backend.requestPermissions.mockImplementation(async () => { throw new Error("Permission denied"); });
    await controller.start(true);
    expect(backend.beginSession).not.toHaveBeenCalled();
  });

  test("duplicate on gestures create only one recording session", async () => {
    const { controller, backend } = setup();
    await Promise.all([controller.start(true), controller.start(true)]);
    expect(backend.beginSession).toHaveBeenCalledTimes(1);
  });

  test("the native service receives the authenticated scope and session", async () => {
    const { controller, native } = setup();
    await controller.start(true);
    expect(JSON.parse((native.start as ReturnType<typeof mock>).mock.calls[0][0])).toMatchObject({ owner: "owner", patientId: "patient", sessionId: "session", siteUrl: "https://example.convex.site", token: "test-token" });
  });

  test("a failed native start closes its unused backend session", async () => {
    const { controller, native, backend } = setup();
    native.start = async () => { throw new Error("Native failure"); };
    await controller.start(true);
    expect(backend.endSession).toHaveBeenCalledWith("session");
  });

  test("switching off stops native capture without ending the session ahead of queued uploads", async () => {
    const { controller, backend } = setup();
    await controller.start(true);
    await controller.stop();
    expect(backend.endSession).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ hasActiveRecording: false, needsFinalization: true });
  });

  test("reconnecting uploads never restarts the microphone", async () => {
    const { controller, native } = setup();
    await controller.retry();
    expect(native.start).not.toHaveBeenCalled();
  });

  test("unfinished audio from another space prevents a new session", async () => {
    const { controller, status, backend } = setup();
    status.blockedByAnotherSpace = true;
    await controller.observe();
    await controller.start(true);
    expect(backend.beginSession).not.toHaveBeenCalled();
  });

  test("a previous offline queue must be resolved before opening another conversation", async () => {
    const { controller, status, native } = setup();
    status.pendingCount = 3;
    await controller.observe();
    await controller.start(true);
    expect(native.start).not.toHaveBeenCalled();
  });

  test("native notification stop updates the toggle without restarting", async () => {
    const { controller, native, status } = setup();
    await controller.start(true);
    status.recording = false;
    status.message = "Stopped from notification.";
    await controller.observe();
    expect(controller.getSnapshot().hasActiveRecording).toBe(false);
    expect(native.start).toHaveBeenCalledTimes(1);
  });

  test("unmount during permission request cannot turn recording on", async () => {
    const { controller, native, backend } = setup();
    backend.requestPermissions.mockImplementation(async () => { controller.dispose(); });
    await controller.start(true);
    expect(native.start).not.toHaveBeenCalled();
  });

  test("missing native support fails closed instead of using an unreliable JS recorder", async () => {
    const { backend } = setup();
    const controller = new ContinuousCaptureController({ native: null, owner: "owner", patientId: "patient", ...backend });
    await controller.start(true);
    expect(backend.beginSession).not.toHaveBeenCalled();
  });
});

describe("native status validation", () => {
  test("rejects malformed or unbounded queue status", () => {
    expect(() => parseCaptureStatus(JSON.stringify({ recording: false, starting: false, uploading: false, pendingCount: 1000, blockedByAnotherSpace: false, message: "" }))).toThrow();
  });
  test("rejects invalid elapsed durations", () => {
    expect(() => parseCaptureStatus(JSON.stringify({ recording: false, starting: false, uploading: false, pendingCount: 0, seconds: -1, blockedByAnotherSpace: false, message: "" }))).toThrow();
  });
});
