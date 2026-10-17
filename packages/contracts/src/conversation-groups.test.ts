import { describe, expect, test } from "bun:test";
import { groupConversationsBySession, type Conversation } from "./index";

function conversation(id: string, startedAt: string, recordingSessionId?: string, sequence?: number): Conversation {
  return {
    id, title: id, summary: "", startedAt, duration: 10, people: [], state: "ready", turns: [], synthetic: false,
    ...(recordingSessionId ? { recordingSessionId } : {}),
    ...(sequence !== undefined ? { sequence } : {}),
  };
}

describe("conversation session display groups", () => {
  test("groups only clips from the same session and orders them by sequence", () => {
    const groups = groupConversationsBySession([
      conversation("clip-2", "2026-10-17T10:00:20.000Z", "session-a", 1),
      conversation("solo", "2026-10-17T11:00:00.000Z"),
      conversation("clip-1", "2026-10-17T10:00:00.000Z", "session-a", 0),
    ]);

    expect(groups.map((group) => group.conversations.map(({ id }) => id))).toEqual([["solo"], ["clip-1", "clip-2"]]);
    expect(groups[1]?.recordingSessionId).toBe("session-a");
  });

  test("keeps independent conversation IDs intact", () => {
    const items = [conversation("clip-1", "2026-10-17T10:00:00.000Z", "session-a", 0), conversation("clip-2", "2026-10-17T10:00:20.000Z", "session-a", 1)];
    const groups = groupConversationsBySession(items);

    expect(groups[0]?.conversations).toEqual([items[0], items[1]]);
    expect(groups[0]?.conversations.map(({ id }) => id)).toEqual(["clip-1", "clip-2"]);
  });
});
