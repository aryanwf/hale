import { describe, expect, mock, test } from "bun:test";
import { MAX_AUDIO_BYTES, MAX_NATIVE_RECORDING_SECONDS } from "@hale/contracts/audio";
import { CaptureController, uploadableRecording, type CaptureBackend, type CaptureDevice, type CaptureStore, type LocalRecording } from "./capture";

function saved(overrides: Partial<LocalRecording> = {}): LocalRecording {
  return { id: "session-1", owner: "owner", patientId: "patient", sessionId: "session-1", uri: "file:///audio.m4a", capturedAt: 1000, durationMs: 5000, endedAt: 6000, ...overrides };
}
function setup(initial: LocalRecording[] = []) {
  let disk = structuredClone(initial);
  const native = { isRecording: false, durationMillis: 0 };
  const device: CaptureDevice = {
    prepare: mock(async () => "file:///new-audio.m4a"),
    record: mock(() => { native.isRecording = true; native.durationMillis = 0; }),
    stop: mock(async () => { native.isRecording = false; }),
    status: () => ({ ...native }), disable: mock(async () => {}),
    measureDuration: mock(async () => native.durationMillis || 5000),
  };
  const store: CaptureStore = { load: () => structuredClone(disk), save: mock((value) => { disk = structuredClone(value); }), removeFile: mock(() => {}), fileSize: () => 2000 };
  let sessionCount = 0;
  const backend: CaptureBackend = { owner: "owner", patientId: "patient", beginSession: mock(async () => `session-new-${++sessionCount}`), endSession: mock(async () => {}), upload: mock(async () => {}) };
  const controller = new CaptureController({ device, store, backend });
  return { controller, device, store, backend, native, disk: () => disk };
}

describe("consented native capture", () => {
  test("never opens the microphone without participant consent", async () => {
    const { controller, device } = setup();
    await controller.start(false);
    expect(device.prepare).not.toHaveBeenCalled();
  });
  test("persists a recovery journal before native recording starts", async () => {
    const { controller, device, disk } = setup();
    device.record = () => { expect(disk()).toHaveLength(1); };
    await controller.start(true);
  });
  test("storage failure prevents microphone capture", async () => {
    const { controller, device, store } = setup();
    store.save = () => { throw new Error("Disk full"); };
    await controller.start(true);
    expect(device.record).not.toHaveBeenCalled();
  });
  test("permission denial never creates a backend session", async () => {
    const { controller, device, backend } = setup();
    device.prepare = async () => { throw new Error("Permission denied"); };
    await controller.start(true);
    expect(backend.beginSession).not.toHaveBeenCalled();
  });
  test("duplicate start taps do not open another recording", async () => {
    const { controller, backend } = setup();
    await Promise.all([controller.start(true), controller.start(true)]);
    expect(backend.beginSession).toHaveBeenCalledTimes(1);
  });
  test("observing an active native recorder does not stop it", async () => {
    const { controller } = setup();
    await controller.start(true);
    controller.observe();
    expect(controller.getSnapshot().phase).toBe("recording");
  });
  test("uses native duration, not a JavaScript interval count", async () => {
    const { controller, native } = setup();
    await controller.start(true);
    native.durationMillis = 180_000;
    controller.observe();
    expect(controller.getSnapshot().seconds).toBe(180);
  });
  test("pause closes a segment before the next recording", async () => {
    const { controller, native } = setup();
    await controller.start(true);
    native.durationMillis = 5000;
    await controller.pause();
    await controller.start(true);
    expect(controller.getSnapshot().pending).toHaveLength(1);
  });
  test("a native interruption never automatically resumes", async () => {
    const { controller, device, native } = setup();
    await controller.start(true);
    native.durationMillis = 5000;
    await controller.interrupt();
    expect(device.record).toHaveBeenCalledTimes(1);
  });
  test("a failed stop retains the active recording for retry", async () => {
    const { controller, device } = setup();
    await controller.start(true);
    device.stop = async () => { throw new Error("Native stop failed"); };
    await controller.stop();
    expect(controller.getSnapshot().hasActiveRecording).toBe(true);
  });
  test("native counter resets do not erase finished media duration", async () => {
    const { controller, device, native } = setup();
    await controller.start(true);
    native.durationMillis = 0;
    device.measureDuration = async () => 180_000;
    await controller.interrupt();
    expect(controller.getSnapshot().pending[0].durationMs).toBe(180_000);
  });
  test("unreadable media is never uploaded", async () => {
    const { controller, device, backend } = setup([saved()]);
    device.measureDuration = async () => { throw new Error("Incomplete audio"); };
    await controller.retry();
    expect(backend.upload).not.toHaveBeenCalled();
  });
  test("an incomplete stopped file can still be discarded", async () => {
    const { controller, native, device } = setup();
    await controller.start(true);
    native.durationMillis = 1000;
    device.measureDuration = async () => { throw new Error("Incomplete media"); };
    await controller.stop();
    controller.discard(controller.getSnapshot().pending[0].id);
    expect(controller.getSnapshot().pending).toHaveLength(0);
  });
  test("a full device queue prevents more capture", async () => {
    const { controller, device } = setup([saved(), saved({ id: "two" }), saved({ id: "three" })]);
    await controller.start(true);
    expect(device.prepare).not.toHaveBeenCalled();
  });
  test("unmount during permission prompt never starts recording", async () => {
    const { controller, device } = setup();
    device.prepare = async () => { controller.dispose(); return "file:///audio.m4a"; };
    await controller.start(true);
    expect(device.record).not.toHaveBeenCalled();
  });
});

describe("durable queue and account isolation", () => {
  test("recovers an interrupted journal without restarting the microphone", () => {
    const { controller } = setup([saved({ endedAt: undefined })]);
    expect(controller.getSnapshot().pending[0].endedAt).toBe(6000);
  });
  test("another account’s recordings stay hidden", () => {
    const { controller } = setup([saved({ owner: "someone-else" })]);
    expect(controller.getSnapshot().pending).toHaveLength(0);
  });
  test("another patient space’s recordings stay hidden", () => {
    const { controller } = setup([saved({ patientId: "another-patient" })]);
    expect(controller.getSnapshot().pending).toHaveLength(0);
  });
  test("retry never uploads another account’s audio", async () => {
    const { controller, backend } = setup([saved({ owner: "someone-else" })]);
    await controller.retry();
    expect(backend.upload).not.toHaveBeenCalled();
  });
  test("a failed upload preserves local audio", async () => {
    const { controller, backend, store } = setup([saved()]);
    backend.upload = async () => { throw new Error("Offline"); };
    await controller.retry();
    expect(store.removeFile).not.toHaveBeenCalled();
  });
  test("successful upload removes the durable queue entry", async () => {
    const { controller, disk } = setup([saved()]);
    await controller.retry();
    expect(disk()).toHaveLength(0);
  });
  test("failed queue commit leaves audio available for an idempotent retry", async () => {
    const { controller, store } = setup([saved()]);
    store.save = () => { throw new Error("Disk full"); };
    await controller.retry();
    expect(controller.getSnapshot().pending).toHaveLength(1);
  });
  test("discard never touches another account’s audio", () => {
    const { controller, store } = setup([saved({ owner: "someone-else" })]);
    controller.discard("session-1");
    expect(store.removeFile).not.toHaveBeenCalled();
  });
  test("discard removes only the selected local file", () => {
    const { controller, disk } = setup([saved(), saved({ id: "two" })]);
    controller.discard("session-1");
    expect(disk().map((item) => item.id)).toEqual(["two"]);
  });
  test("empty media is never uploaded", async () => {
    const { controller, store, backend } = setup([saved()]);
    store.fileSize = () => 0;
    await controller.retry();
    expect(backend.upload).not.toHaveBeenCalled();
  });
});

describe("upload boundaries", () => {
  test("accepts the one-hour boundary", () => {
    expect(uploadableRecording(saved({ durationMs: MAX_NATIVE_RECORDING_SECONDS * 1000, endedAt: 1000 + MAX_NATIVE_RECORDING_SECONDS * 1000 }), MAX_AUDIO_BYTES)).toBe(true);
  });
  test("rejects oversized media", () => { expect(uploadableRecording(saved(), MAX_AUDIO_BYTES + 1)).toBe(false); });
  test("rejects negative media size", () => { expect(uploadableRecording(saved(), -1)).toBe(false); });
  test("rejects missing end time", () => { expect(uploadableRecording(saved({ endedAt: undefined }), 100)).toBe(false); });
  test("rejects duration beyond native maximum", () => { expect(uploadableRecording(saved({ endedAt: 1001 + MAX_NATIVE_RECORDING_SECONDS * 1000 }), 100)).toBe(false); });
});
