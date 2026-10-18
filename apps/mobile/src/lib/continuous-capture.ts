export interface NativeCaptureStatus {
  recording: boolean;
  starting: boolean;
  uploading: boolean;
  pendingCount: number;
  blockedByAnotherSpace: boolean;
  message: string;
  sessionId?: string;
  seconds?: number;
  needsFinalization?: boolean;
}

export interface NativeCapture {
  start(options: string): Promise<void>;
  stop(owner: string, patientId: string): Promise<void>;
  status(owner: string, patientId: string): Promise<string>;
  credentials(owner: string, patientId: string, token: string): Promise<void>;
  discard(owner: string, patientId: string): Promise<void>;
  retryUploads(owner: string, patientId: string): Promise<void>;
}

export interface ContinuousSnapshot {
  phase: "idle" | "starting" | "recording" | "saving";
  hasActiveRecording: boolean;
  seconds: number;
  pendingCount: number;
  uploading: boolean;
  message: string;
  sessionId?: string;
  needsFinalization: boolean;
  blockedByAnotherSpace: boolean;
  available: boolean;
}

interface Dependencies {
  native: NativeCapture | null;
  owner: string;
  patientId: string;
  requestPermissions(): Promise<void>;
  beginSession(expectedPeople: string[]): Promise<string>;
  endSession(id: string): Promise<void>;
  uploadCredentials(): Promise<{ siteUrl: string; token: string }>;
}

export class ContinuousCaptureController {
  private listeners = new Set<() => void>();
  private busy = false;
  private observing = false;
  private disposed = false;
  private snapshot: ContinuousSnapshot;

  constructor(private dependencies: Dependencies) {
    this.snapshot = {
      phase: "idle", hasActiveRecording: false, seconds: 0, pendingCount: 0, uploading: false,
      message: "", available: Boolean(dependencies.native), needsFinalization: false, blockedByAnotherSpace: false,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.snapshot;
  private update(patch: Partial<ContinuousSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  observe = async () => {
    if (!this.dependencies.native || this.observing || this.disposed) return;
    this.observing = true;
    try {
      const { native, owner, patientId } = this.dependencies;
      const status = parseCaptureStatus(await native.status(owner, patientId));
      if (this.disposed) return;
      this.update({
        phase: status.starting || (this.busy && this.snapshot.phase === "starting" && !status.recording) ? "starting" : status.recording ? "recording" : "idle",
        hasActiveRecording: status.recording || status.starting, seconds: status.seconds ?? 0,
        pendingCount: status.pendingCount, uploading: status.uploading, message: status.message,
        sessionId: status.sessionId, needsFinalization: status.needsFinalization ?? false,
        blockedByAnotherSpace: status.blockedByAnotherSpace,
      });
    } catch {
      this.update({ message: "Couldn’t read microphone status. Check the Android recording notification; use its Stop action if needed." });
    } finally { this.observing = false; }
  };

  start = async (consented: boolean, expectedPeople: string[] = []) => {
    const { native, owner, patientId } = this.dependencies;
    if (!native || this.busy || this.disposed || this.snapshot.hasActiveRecording) return;
    if (!consented) { this.update({ message: "Everyone present must agree before you switch recording on." }); return; }
    if (this.snapshot.blockedByAnotherSpace || this.snapshot.pendingCount || this.snapshot.needsFinalization) {
      this.update({ message: "Finish or discard the previous session’s unsent audio before starting another conversation." });
      return;
    }
    this.busy = true;
    this.update({ phase: "starting", message: "" });
    let sessionId: string | undefined;
    try {
      await this.dependencies.requestPermissions();
      const credentials = await this.dependencies.uploadCredentials();
      if (this.disposed) return;
      sessionId = await this.dependencies.beginSession(expectedPeople);
      if (this.disposed) throw new Error("Hale closed before recording could start.");
      await native.start(JSON.stringify({ ...credentials, owner, patientId, sessionId }));
      this.update({ sessionId, hasActiveRecording: true, seconds: 0 });
      await this.observe();
    } catch (error) {
      if (sessionId) await this.dependencies.endSession(sessionId).catch(() => {});
      this.update({ phase: "idle", message: error instanceof Error ? error.message : "The microphone could not start." });
    } finally { this.busy = false; }
  };

  stop = async () => {
    const { native, owner, patientId } = this.dependencies;
    if (!native || this.busy) return;
    this.busy = true;
    this.update({ phase: "saving" });
    try { await native.stop(owner, patientId); await this.observe(); }
    catch { this.update({ message: "The microphone is still stopping. Try again, or use Stop in the Android notification." }); }
    finally { this.busy = false; }
  };

  refreshCredentials = async () => {
    const { native, owner, patientId } = this.dependencies;
    if (!native || this.disposed || this.snapshot.blockedByAnotherSpace) return;
    try {
      const { token } = await this.dependencies.uploadCredentials();
      if (this.disposed) return;
      await native.credentials(owner, patientId, token);
      await this.observe();
    } catch { this.update({ message: "Couldn’t reconnect. Sign in and check your connection; unsent audio remains on this device." }); }
  };

  retry = async () => {
    const { native, owner, patientId } = this.dependencies;
    if (!native || this.disposed || this.snapshot.blockedByAnotherSpace) return;
    await this.refreshCredentials();
    try { await native.retryUploads(owner, patientId); }
    catch { this.update({ message: "Couldn’t retry uploads. Open the original account and patient space." }); }
  };

  discard = async () => {
    const { native, owner, patientId } = this.dependencies;
    if (!native || this.snapshot.hasActiveRecording || this.snapshot.uploading) return;
    try {
      await native.discard(owner, patientId);
      if (this.snapshot.sessionId) await this.dependencies.endSession(this.snapshot.sessionId).catch(() => {});
      await this.observe();
    }
    catch { this.update({ message: "Couldn’t discard the unsent audio. Wait for uploads to finish and try again." }); }
  };

  dispose = () => {
    this.disposed = true;
    const { native, owner, patientId } = this.dependencies;
    if (native) void native.stop(owner, patientId).then(() => native.credentials(owner, patientId, "")).catch(() => {});
  };
}

export function parseCaptureStatus(json: string): NativeCaptureStatus {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== "object") throw new Error("Invalid capture status.");
  const status = value as Record<string, unknown>;
  if (["recording", "starting", "uploading", "blockedByAnotherSpace"].some((key) => typeof status[key] !== "boolean")
    || !Number.isInteger(status.pendingCount) || (status.pendingCount as number) < 0 || (status.pendingCount as number) > 31
    || typeof status.message !== "string"
    || (status.sessionId !== undefined && typeof status.sessionId !== "string")
    || (status.seconds !== undefined && (typeof status.seconds !== "number" || !Number.isFinite(status.seconds) || status.seconds < 0))
    || (status.needsFinalization !== undefined && typeof status.needsFinalization !== "boolean")) throw new Error("Invalid capture status.");
  return status as unknown as NativeCaptureStatus;
}
