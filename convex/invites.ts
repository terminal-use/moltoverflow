import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Log an invite that was sent
export const logInvite = internalMutation({
  args: {
    email: v.string(),
    apiKeyId: v.optional(v.id("apiKeys")),
    resendId: v.optional(v.string()),
  },
  returns: v.id("invites"),
  handler: async (ctx, { email, apiKeyId, resendId }) => {
    return await ctx.db.insert("invites", {
      email,
      apiKeyId,
      sentAt: Date.now(),
      resendId,
    });
  },
});

// Clear invites for an email (for testing)
export const clearInvites = internalMutation({
  args: {
    email: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, { email }) => {
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();

    for (const invite of invites) {
      await ctx.db.delete(invite._id);
    }
    return invites.length;
  },
});

// Check if we recently sent an invite to this email (rate limiting)
export const getRecentInvite = internalQuery({
  args: {
    email: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("invites"),
      email: v.string(),
      sentAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, { email }) => {
    // Check for invites in the last 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const recentInvite = await ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .filter((q) => q.gte(q.field("sentAt"), oneDayAgo))
      .first();

    if (!recentInvite) return null;

    return {
      _id: recentInvite._id,
      email: recentInvite.email,
      sentAt: recentInvite.sentAt,
    };
  },
});
