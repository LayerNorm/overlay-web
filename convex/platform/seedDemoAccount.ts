import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireServerSecret } from "../lib/auth";

/**
 * Seeds a demo account with sample data for App Store review.
 * Run via Convex dashboard or CLI after creating a real user account.
 * Requires INTERNAL_API_SECRET so this cannot be invoked from the public Convex API.
 *
 * Usage:
 *   npx convex run seedDemoAccount '{"serverSecret":"<INTERNAL_API_SECRET>","userId":"auth_user_xxx"}'
 */
export default mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);
    const { userId } = args;

    // Verify the user exists in subscriptions
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!existing) {
      throw new Error(`No subscription found for userId: ${userId}`);
    }

    // 1. Create sample notes (notes are Markdown `files` rows of kind "note")
    const insertNote = (name: string, content: string, tags: string[], createdAt: number) => ctx.db.insert("files", {
      name,
      type: "file",
      kind: "note",
      extension: "md",
      content,
      sizeBytes: new TextEncoder().encode(content).length,
      tags,
      userId,
      createdAt,
      updatedAt: createdAt,
    });
    const note1 = await insertNote(
      "Getting Started",
      "Welcome to Overlay! This is a note where you can write ideas, drafts, and documents with AI assistance.",
      ["welcome", "getting-started"],
      Date.now(),
    );

    const note2Promise = insertNote(
      "Project Ideas",
      "- Build an AI-powered mobile app\n- Launch on Product Hunt\n- Write blog posts about AI workflows",
      ["ideas", "getting-started"],
      Date.now() - 86400000,
    );

    // 2. Create a saved memory
    const memoriesPromise = ctx.db.insert('memories', {
      content:
        'User prefers concise, bullet-point summaries. Interested in productivity tools, AI workflows, and building efficient teams.',
      source: "manual",
      userId,
      createdAt: Date.now(),
    });

    // 3. Create sample file
    const filesPromise = ctx.db.insert('files', {
      name: "Overlay Documentation",
      type: "file",
      kind: "upload",
      content: "Overlay is a model-agnostic AI workspace. Features: Chat, Memory, Notes, Automations, and Integrations.",
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // 4. Create a sample chat conversation (independent of the notes/memories/files inserts)
    const [note2, , , conversation] = await Promise.all([
      note2Promise,
      memoriesPromise,
      filesPromise,
      ctx.db.insert('conversations', {
      title: "Welcome Chat",
      userId,
      lastModified: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMode: "ask",
      askModelIds: ["gpt-4o"],
      actModelId: "gpt-4o",
      }),
    ])

    const turnId = crypto.randomUUID();

    await Promise.all([
      ctx.db.insert('conversationMessages', {
      conversationId: conversation,
      userId,
      turnId,
      role: "user",
      mode: "ask",
      content: "What can you help me with?",
      contentType: "text",
      createdAt: Date.now() - 120000,
      }),
      ctx.db.insert('conversationMessages', {
      conversationId: conversation,
      userId,
      turnId,
      role: "assistant",
      mode: "ask",
      content: "I can help you with a wide range of tasks! I can write and edit documents, brainstorm ideas, analyze data, write code, answer questions, and much more. What would you like to work on today?",
      contentType: "text",
      createdAt: Date.now() - 60000,
      }),
    ])

    return {
      success: true,
      noteIds: [note1, note2],
      conversationId: conversation,
      message: `Demo data seeded for user ${userId}`,
    };
  },
});
