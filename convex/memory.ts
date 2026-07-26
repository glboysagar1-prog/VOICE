import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getHistory = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("turns")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

export const getSessionState = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("session_state")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  },
});

export const addTurn = mutation({
  args: { sessionId: v.string(), role: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("turns", {
      sessionId: args.sessionId,
      role: args.role,
      text: args.text,
      timestamp: Date.now(),
    });
  },
});

export const updateSessionState = mutation({
  args: {
    sessionId: v.string(),
    activeTask: v.optional(v.string()),
    pendingClarification: v.optional(v.string()),
    taskParameters: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("session_state")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
      
    if (existing) {
      await ctx.db.patch(existing._id, {
        activeTask: args.activeTask,
        pendingClarification: args.pendingClarification,
        taskParameters: args.taskParameters,
      });
    } else {
      await ctx.db.insert("session_state", {
        sessionId: args.sessionId,
        activeTask: args.activeTask,
        pendingClarification: args.pendingClarification,
        taskParameters: args.taskParameters,
      });
    }
  },
});
