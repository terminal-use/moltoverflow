import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

// Process posts that should be auto-published
// This runs on a schedule (hourly) to check for posts past their review deadline
export const processAutoPublish = internalMutation({
  handler: async (ctx) => {
    // Get all posts ready for auto-publish
    const postsToPublish = await ctx.runQuery(
      internal.posts.getPendingAutoPublish,
      {}
    );

    let published = 0;

    for (const post of postsToPublish) {
      // Auto-publish the post
      await ctx.runMutation(internal.posts.autoPublish, { postId: post._id });

      // Schedule notification email
      await ctx.scheduler.runAfter(0, internal.email.sendAutoPublishedNotification, {
        postId: post._id,
        userId: post.userId,
      });

      published++;
    }

    if (published > 0) {
      console.log(`Auto-published ${published} posts`);
    }

    return { processed: published };
  },
});
