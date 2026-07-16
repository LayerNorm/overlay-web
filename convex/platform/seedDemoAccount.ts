import { v } from "convex/values";
import { mutation } from "../_generated/server";

/**
 * Seeds a demo account with sample data for App Store review.
 * Run via Convex dashboard or CLI after creating a real user account.
 *
 * Usage:
 *   npx convex run seedDemoAccount '{"userId": "auth_user_xxx"}'
 */
export default mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    // Verify the user exists in subscriptions
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (!existing) {
      throw new Error(`No subscription found for userId: ${userId}`);
    }

    // 1. Create a sample project
    const project = await ctx.db.insert("projects", {
      name: "Welcome to Overlay",
      instructions: "Your AI workspace for projects, notes, and conversations.",
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // 2. Create sample notes
    const note1 = await ctx.db.insert("notes", {
      title: "Getting Started",
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Welcome to Overlay! This is a rich text note where you can write ideas, drafts, and documents with AI assistance." },
            ],
          },
        ],
      }),
      tags: ["welcome", "getting-started"],
      userId,
      projectId: project,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const note2 = await ctx.db.insert("notes", {
      title: "Project Ideas",
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "bullet_list",
            content: [
              { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Build an AI-powered mobile app" }] }] },
              { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Launch on Product Hunt" }] }] },
              { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Write blog posts about AI workflows" }] }] },
            ],
          },
        ],
      }),
      tags: ["ideas", "projects"],
      userId,
      projectId: project,
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now() - 86400000,
    });

    // 3. Create a saved memory
    await ctx.db.insert("memories", {
      content: "User prefers concise, bullet-point summaries. Interested in productivity tools, AI workflows, and building efficient teams.",
      source: "manual",
      userId,
      createdAt: Date.now(),
    });

    // 4. Create sample file
    await ctx.db.insert("files", {
      name: "Overlay Documentation",
      type: "file",
      kind: "upload",
      content: "Overlay is a model-agnostic AI workspace. Features: Chat, Memory, Notes, Projects, Knowledge Base, Automations, and Integrations.",
      userId,
      projectId: project,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // 5. Create a sample chat conversation
    const conversation = await ctx.db.insert("conversations", {
      title: "Welcome Chat",
      userId,
      lastModified: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMode: "ask",
      askModelIds: ["gpt-4o"],
      actModelId: "gpt-4o",
    });

    const turnId = crypto.randomUUID();

    await ctx.db.insert("conversationMessages", {
      conversationId: conversation,
      userId,
      turnId,
      role: "user",
      mode: "ask",
      content: "What can you help me with?",
      contentType: "text",
      createdAt: Date.now() - 120000,
    });

    await ctx.db.insert("conversationMessages", {
      conversationId: conversation,
      userId,
      turnId,
      role: "assistant",
      mode: "ask",
      content: "I can help you with a wide range of tasks! I can write and edit documents, brainstorm ideas, analyze data, write code, answer questions, and much more. What would you like to work on today?",
      contentType: "text",
      createdAt: Date.now() - 60000,
    });

    return {
      success: true,
      projectId: project,
      noteIds: [note1, note2],
      conversationId: conversation,
      message: `Demo data seeded for user ${userId}`,
    };
  },
});
