import { describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import * as reset from "./reset";
import schema from "./schema";

const app = defineTestApp({ schema }).defineModules({ reset });
const confirmation = "RESET_DEMO_DATA";

async function resetWithStoredFile() {
  const t = app.createTest();
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["demo audio"])));
  const result = await t.action(app.internal.reset.resetDemoData, { confirmation });
  return { t, storageId, result };
}

describe("demo data reset", () => {
  test("removes application documents across tables", async () => {
    const t = app.createTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("deletedAccounts", { identityHash: "a".repeat(64) });
      await ctx.db.insert("patients", {
        name: "Demo patient",
        timezone: "UTC",
        createdBy: "user_demo",
        audioRetentionDays: 7,
        createdAt: 0,
      });
    });

    const result = await t.action(app.internal.reset.resetDemoData, { confirmation });

    expect(result.deletedDocuments).toBe(2);
  });

  test("removes every stored file", async () => {
    const { result } = await resetWithStoredFile();
    expect(result.deletedFiles).toBe(1);
  });

  test("deletes file contents from Convex storage", async () => {
    const { t, storageId } = await resetWithStoredFile();
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });

  test("requires the exact reset confirmation", async () => {
    const t = app.createTest();

    // @ts-expect-error Deliberately exercise runtime argument validation.
    await expect(t.action(app.internal.reset.resetDemoData, { confirmation: "RESET" })).rejects.toThrow();
  });
});
