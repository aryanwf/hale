import { MAX_AUDIO_BYTES, MAX_NATIVE_RECORDING_SECONDS } from "@hale/contracts/audio";

export const MAX_PENDING_RECORDINGS = 3;
export type CapturePhase = "idle" | "starting" | "recording" | "saving" | "paused" | "interrupted";
export interface LocalRecording {
  id: string;
  owner: string;
  patientId: string;
  sessionId: string;
  uri: string;
  capturedAt: number;
  durationMs: number;
  endedAt?: number;
}
export interface CaptureSnapshot {
  phase: CapturePhase;
  hasActiveRecording: boolean;
  seconds: number;
  pending: LocalRecording[];
  uploading: boolean;
  message: string;
}
export interface CaptureStore {
  load(): LocalRecording[];
  save(recordings: LocalRecording[]): void;
  removeFile(uri: string): void;
  fileSize(uri: string): number;
}
export interface CaptureDevice {
  prepare(): Promise<string>;
  record(): void;
  stop(): Promise<void>;
  status(): { isRecording: boolean; durationMillis: number };
  measureDuration(uri: string): Promise<number>;
  disable(): Promise<void>;
}
export interface CaptureBackend {
  owner: string;
  patientId: string;
  autoUploadOnStop?: boolean;
  beginSession(expectedPeople: string[]): Promise<string>;
  endSession(sessionId: string): Promise<void>;
  upload(recording: LocalRecording): Promise<void>;
}

export function uploadableRecording(recording: LocalRecording, size: number): boolean {
  return Boolean(recording.endedAt) && recording.durationMs > 0
    && recording.endedAt! > recording.capturedAt
    && recording.endedAt! - recording.capturedAt <= MAX_NATIVE_RECORDING_SECONDS * 1000
    && size > 0 && size <= MAX_AUDIO_BYTES;
}

export class CaptureController {
  private listeners = new Set<() => void>();
  private records: LocalRecording[];
  private active: LocalRecording | null = null;
  private busy = false;
  private disposed = false;
  private snapshot: CaptureSnapshot;

  constructor(private dependencies: { device: CaptureDevice; store: CaptureStore; backend: CaptureBackend }) {
    this.records = dependencies.store.load();
    this.snapshot = { phase: "idle", hasActiveRecording: false, seconds: 0, pending: [], uploading: false, message: "" };
    const recovered = this.records.filter((record) => !record.endedAt);
    this.records = this.records.map((record) => record.endedAt ? record : {
      ...record, endedAt: record.capturedAt + Math.min(record.durationMs, MAX_NATIVE_RECORDING_SECONDS * 1000),
    });
    if (recovered.length) dependencies.store.save(this.records);
    this.update(recovered.length ? { message: "A previous recording was interrupted. Its temporary clip is ready to upload or discard. Recovery uses the last measured duration; the final seconds may be missing." } : {});
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;

  private update(patch: Partial<CaptureSnapshot>) {
    const { owner, patientId } = this.dependencies.backend;
    this.snapshot = { ...this.snapshot, ...patch, hasActiveRecording: this.active !== null, pending: this.records.filter((record) => record.id !== this.active?.id && record.endedAt !== undefined && record.owner === owner && record.patientId === patientId) };
    for (const listener of this.listeners) listener();
  }

  private persist() { this.dependencies.store.save(this.records); }

  start = async (consented: boolean, expectedPeople: string[] = []) => {
    if (this.disposed || this.busy || this.active || this.snapshot.uploading) return;
    if (!consented) { this.update({ message: "Everyone taking part must agree before recording." }); return; }
    if (this.records.length >= MAX_PENDING_RECORDINGS) { this.update({ message: "Your temporary upload queue is full. Upload or discard a clip before recording more." }); return; }
    this.busy = true;
    this.update({ phase: "starting", message: "" });
    let sessionId: string | undefined;
    let uri: string | undefined;
    try {
      uri = await this.dependencies.device.prepare();
      if (this.disposed) throw new Error("Hale closed before recording could start.");
      sessionId = await this.dependencies.backend.beginSession(expectedPeople);
      if (this.disposed) throw new Error("Hale closed before recording could start.");
      const capturedAt = Date.now();
      const { owner, patientId } = this.dependencies.backend;
      this.active = { id: sessionId, owner, patientId, sessionId, uri, capturedAt, durationMs: 0 };
      this.records.push(this.active);
      this.persist();
      this.dependencies.device.record();
      this.update({ phase: "recording", seconds: 0 });
    } catch (error) {
      try { await this.dependencies.device.stop(); } catch { /* A prepared recorder may not have started. */ }
      if (this.active) this.records = this.records.filter((record) => record.id !== this.active!.id);
      this.active = null;
      try { this.persist(); } catch { /* Keep the on-disk journal for recovery if storage has failed. */ }
      if (uri) {
        try { this.dependencies.store.removeFile(uri); } catch { /* Cleanup must not prevent releasing the audio session. */ }
      }
      if (sessionId) await this.dependencies.backend.endSession(sessionId).catch(() => {});
      await this.dependencies.device.disable().catch(() => {});
      this.update({ phase: "idle", message: error instanceof Error ? error.message : "Couldn’t start recording." });
    } finally { this.busy = false; }
  };

  observe = () => {
    if (this.disposed || this.busy || !this.active) return;
    const status = this.dependencies.device.status();
    if (!status.isRecording) { void this.interrupt(); return; }
    const durationMs = Math.max(0, Math.min(status.durationMillis, MAX_NATIVE_RECORDING_SECONDS * 1000));
    this.active.durationMs = durationMs;
    try { this.persist(); }
    catch { void this.interrupt("Storage unavailable. Recording stopped."); return; }
    this.update({ seconds: durationMs / 1000 });
  };

  stop = () => this.finish("idle");
  pause = () => this.finish("paused");
  interrupt = (message = "Recording interrupted.") => this.finish("interrupted", message);

  private async finish(phase: CapturePhase, message = "") {
    if (this.busy || !this.active) return;
    this.busy = true;
    this.update({ phase: "saving" });
    const recording = this.active;
    try {
      const status = this.dependencies.device.status();
      recording.durationMs = Math.max(recording.durationMs, Math.min(status.durationMillis, MAX_NATIVE_RECORDING_SECONDS * 1000));
      await this.dependencies.device.stop();
      this.active = null;
      recording.endedAt = recording.capturedAt + recording.durationMs;
      this.persist();
      recording.durationMs = await this.dependencies.device.measureDuration(recording.uri);
      // Each pause closes a file/session, so pause gaps never become source audio timestamps.
      recording.endedAt = recording.capturedAt + recording.durationMs;
      this.persist();
       this.update({ phase, message: message || "Recording finalized. Uploading the temporary clip for transcription…" });
    } catch {
      this.update({ phase: "interrupted", message: this.active ? "Couldn’t stop recording. Tap Stop to retry." : "Recording may be incomplete. Review it before uploading." });
    } finally {
      if (!this.active) {
        await this.dependencies.device.disable().catch(() => {});
        void this.dependencies.backend.endSession(recording.sessionId).catch(() => {});
      }
      this.busy = false;
    }
    if (this.dependencies.backend.autoUploadOnStop && this.snapshot.pending.length) void this.retry();
  }

  retry = async () => {
    if (this.disposed || this.busy || this.active || this.snapshot.uploading) return;
    this.update({ uploading: true, message: "" });
    try {
      for (const recording of [...this.snapshot.pending]) {
        recording.durationMs = await this.dependencies.device.measureDuration(recording.uri);
        recording.endedAt = recording.capturedAt + recording.durationMs;
        this.persist();
        if (!uploadableRecording(recording, this.dependencies.store.fileSize(recording.uri))) throw new Error("This clip is empty, incomplete, or exceeds the one-hour/20 MB limit. Its temporary local copy remains here; discard it if you don’t want to retry.");
        await this.dependencies.backend.upload(recording);
        await this.dependencies.backend.endSession(recording.sessionId);
        // Commit removal before deleting bytes; an upload failure keeps its temporary retry copy.
        const remaining = this.records.filter((record) => record.id !== recording.id);
        this.dependencies.store.save(remaining);
        this.records = remaining;
        this.dependencies.store.removeFile(recording.uri);
        this.update({});
      }
      this.update({ message: "Uploaded for transcription. Hale deletes the temporary server copy after transcription and any selected speaker matching." });
    } catch (error) {
      this.update({ message: error instanceof Error ? error.message : "Upload failed. The temporary local clip remains here until retry or discard." });
    } finally { this.update({ uploading: false }); }
  };

  discard = (id: string) => {
    if (this.busy || this.active || this.snapshot.uploading) return;
    const recording = this.snapshot.pending.find((record) => record.id === id);
    if (!recording) return;
    try {
      const remaining = this.records.filter((record) => record.id !== id);
      this.dependencies.store.save(remaining);
      this.records = remaining;
      this.dependencies.store.removeFile(recording.uri);
    } catch { this.update({ message: "Couldn’t discard recording. Try again." }); return; }
    void this.dependencies.backend.endSession(recording.sessionId).catch(() => {});
    this.update({ message: "Temporary local audio discarded. Previously uploaded transcript text is unaffected." });
  };

  dispose = () => {
    this.disposed = true;
    if (this.active) void this.finish("interrupted");
  };
}
