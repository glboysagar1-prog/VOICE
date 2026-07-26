import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  turns: defineTable({
    sessionId: v.string(),
    role: v.string(), // "user" or "assistant"
    text: v.string(),
    timestamp: v.number(),
  }).index("by_session", ["sessionId"]),
  
  session_state: defineTable({
    sessionId: v.string(),
    activeTask: v.optional(v.string()), // e.g., "list_restaurants"
    pendingClarification: v.optional(v.string()), // the last clarifying question we asked
    taskParameters: v.optional(v.string()), // JSON string of parameters collected so far
  }).index("by_session", ["sessionId"]),
});
