import { describe, expect, test } from "bun:test";
import { matchTranscriptTurns } from "./speakerMatching";

const turns = [{ id: "turn-1", start: 0, end: 4 }];
const candidates = [{ label: "p_grace", personId: "grace" }];
const twoCandidates = [...candidates, { label: "p_other", personId: "other" }];

function output(overrides: Record<string, unknown> = {}) {
  return {
    diarization: [{ speaker: "SPEAKER_00", start: 0, end: 4 }],
    voiceprints: [{ speaker: "SPEAKER_00", confidence: { p_grace: 86 } }],
    ...overrides,
  };
}

describe("conservative transcript speaker matching", () => {
  test("maps a turn only after a clear, high-confidence match", () => {
    expect(matchTranscriptTurns(turns, output(), candidates, 10)).toEqual([
      { turnId: "turn-1", label: "p_grace" },
    ]);
  });

  test("leaves overlapping or partially covered transcript turns unknown", () => {
    const overlapping = output({ diarization: [
      { speaker: "SPEAKER_00", start: 0, end: 3 },
      { speaker: "SPEAKER_01", start: 2, end: 4 },
    ] });
    expect(matchTranscriptTurns(turns, overlapping, candidates, 10)).toEqual([{ turnId: "turn-1" }]);
    expect(matchTranscriptTurns(turns, output({ diarization: [{ speaker: "SPEAKER_00", start: 0, end: 2.5 }] }), candidates, 10))
      .toEqual([{ turnId: "turn-1" }]);
  });

  test("rejects weak, ambiguous, and too-short speaker samples", () => {
    expect(matchTranscriptTurns(turns, output({ voiceprints: [{ speaker: "SPEAKER_00", confidence: { p_grace: 69 } }] }), candidates, 10))
      .toEqual([{ turnId: "turn-1" }]);
    expect(matchTranscriptTurns(turns, output({ voiceprints: [{ speaker: "SPEAKER_00", confidence: { p_grace: 82, p_other: 70 } }] }), twoCandidates, 10))
      .toEqual([{ turnId: "turn-1" }]);
    expect(matchTranscriptTurns(turns, output({ diarization: [{ speaker: "SPEAKER_00", start: 0, end: 1.9 }] }), candidates, 10))
      .toEqual([{ turnId: "turn-1" }]);
  });

  test("fails closed on malformed provider output", () => {
    expect(() => matchTranscriptTurns(turns, { diarization: [], voiceprints: "bad" }, candidates, 10))
      .toThrow("invalid result");
  });
});
