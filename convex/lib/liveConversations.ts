import type { GenericId } from "convex/values";
import type { DataModel, MutationCtx, QueryCtx } from "./functions";

type Conversation = DataModel["conversations"]["document"];
type Chunk = DataModel["audioChunks"]["document"];

export async function conversationForChunk(ctx: QueryCtx, chunk: Chunk) {
  return chunk.conversationId
    ? ctx.db.get(chunk.conversationId)
    : ctx.db.query("conversations").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique();
}

export async function refreshLiveConversation(ctx: MutationCtx, conversationId: GenericId<"conversations">) {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation?.sessionId || conversation.deletedAt) return;
  const session = await ctx.db.get(conversation.sessionId);
  const recording = session?.state === "recording";
  const pending = conversation.pendingChunks ?? 0;
  const failures = conversation.failedChunks ?? 0;
  await ctx.db.patch(conversationId, {
    state: recording || pending > 0 ? "processing" : failures > 0 && failures === conversation.processedChunks ? "failed" : "ready",
    summary: `${recording ? "Listening. Dialogue is appended as each segment is transcribed." : pending ? "Recording stopped. Finishing the remaining transcript." : "Recording finished. Transcript text is saved; temporary audio is deleted after processing."}${failures ? ` ${failures} segment(s) could not be transcribed; there may be gaps.` : ""}`,
  });
}

export async function settleLiveChunk(ctx: MutationCtx, conversation: Conversation, outcome: "ready" | "failed") {
  await ctx.db.patch(conversation._id, {
    pendingChunks: Math.max(0, (conversation.pendingChunks ?? 0) - 1),
    processedChunks: (conversation.processedChunks ?? 0) + 1,
    failedChunks: (conversation.failedChunks ?? 0) + (outcome === "failed" ? 1 : 0),
  });
  await refreshLiveConversation(ctx, conversation._id);
}
