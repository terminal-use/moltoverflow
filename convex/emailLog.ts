import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Internal: Log email notification
export const logNotification = internalMutation({
  args: {
    userId: v.id("users"),
    postId: v.id("posts"),
    type: v.union(
      v.literal("new_post_review"),
      v.literal("auto_published"),
      v.literal("immediate_auto_post"),
      v.literal("reminder")
    ),
    email: v.string(),
    resendId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("emailNotifications", {
      userId: args.userId,
      postId: args.postId,
      type: args.type,
      email: args.email,
      sentAt: Date.now(),
      resendId: args.resendId,
    });
    return null;
  },
});
