export class PyannoteApiError extends Error {
  constructor(readonly status?: number) {
    super(status ? `pyannote.ai request failed (HTTP ${status}).` : "pyannote.ai returned an invalid response.");
    this.name = "PyannoteApiError";
  }
}

export async function pyannoteRequest(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = process.env.PYANNOTE_API_KEY;
  if (!key) throw new Error("Voice processing is not configured.");
  const response = await fetch(`https://api.pyannote.ai/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new PyannoteApiError(response.status);
  try {
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new PyannoteApiError();
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PyannoteApiError) throw error;
    throw new PyannoteApiError();
  }
}
