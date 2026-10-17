import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./lib/functions";
import schema from "./schema";

const RESET_CONFIRMATION = "RESET_DEMO_DATA";
const RESET_BATCH_SIZE = 100;
const TABLE_NAMES = Object.keys(schema.tables) as TableNames[];
const batchResultValidator = v.object({ deleted: v.number(), isDone: v.boolean() });
const resetResultValidator = v.object({ deletedDocuments: v.number(), deletedFiles: v.number() });

export const clearTableBatch = internalMutation({
  args: { tableIndex: v.number(), confirmation: v.literal(RESET_CONFIRMATION) },
  returns: batchResultValidator,
  handler: async (ctx, { tableIndex }) => {
    const tableName = TABLE_NAMES[tableIndex];
    if (!Number.isInteger(tableIndex) || !tableName) {
      throw new ConvexError("Invalid table for the demo reset.");
    }

    const documents = await ctx.db.query(tableName).take(RESET_BATCH_SIZE);
    for (const document of documents) await ctx.db.delete(document._id);

    return { deleted: documents.length, isDone: documents.length < RESET_BATCH_SIZE };
  },
});

export const clearStorageBatch = internalMutation({
  args: { confirmation: v.literal(RESET_CONFIRMATION) },
  returns: batchResultValidator,
  handler: async (ctx) => {
    const files = await ctx.db.system.query("_storage").take(RESET_BATCH_SIZE);
    for (const file of files) await ctx.storage.delete(file._id);

    return { deleted: files.length, isDone: files.length < RESET_BATCH_SIZE };
  },
});

export const resetDemoData = internalAction({
  args: { confirmation: v.literal(RESET_CONFIRMATION) },
  returns: resetResultValidator,
  handler: async (ctx) => {
    let deletedDocuments = 0;
    let deletedFiles = 0;

    for (let tableIndex = 0; tableIndex < TABLE_NAMES.length; tableIndex++) {
      let isDone = false;
      while (!isDone) {
        const batch: { deleted: number; isDone: boolean } = await ctx.runMutation(internal.reset.clearTableBatch, {
          tableIndex,
          confirmation: RESET_CONFIRMATION,
        });
        deletedDocuments += batch.deleted;
        isDone = batch.isDone;
      }
    }

    let storageIsEmpty = false;
    while (!storageIsEmpty) {
      const batch: { deleted: number; isDone: boolean } = await ctx.runMutation(internal.reset.clearStorageBatch, {
        confirmation: RESET_CONFIRMATION,
      });
      deletedFiles += batch.deleted;
      storageIsEmpty = batch.isDone;
    }

    return { deletedDocuments, deletedFiles };
  },
});
