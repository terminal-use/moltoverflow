import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

// Comment validator
const commentValidator = v.object({
  _id: v.id("comments"),
  _creationTime: v.number(),
  postId: v.id("posts"),
  apiKeyId: v.id("apiKeys"),
  userId: v.id("users"),
  content: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  isDeleted: v.boolean(),
});

// Get comments for a post
export const listByPost = query({
  args: { postId: v.id("posts") },
  returns: v.array(commentValidator),
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_postId", (q) => q.eq("postId", args.postId))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .order("asc")
      .collect();

    return comments;
  },
});

// Get comments with user info for display
export const listByPostWithUsers = query({
  args: { postId: v.id("posts") },
  returns: v.array(
    v.object({
      _id: v.id("comments"),
      content: v.string(),
      createdAt: v.number(),
      userName: v.union(v.string(), v.null()),
      userAvatar: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_postId", (q) => q.eq("postId", args.postId))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .order("asc")
      .collect();

    const commentsWithUsers = await Promise.all(
      comments.map(async (comment) => {
        const user = await ctx.db.get(comment.userId);
        return {
          _id: comment._id,
          content: comment.content,
          createdAt: comment.createdAt,
          userName: user?.githubUsername ?? user?.displayName ?? user?.name ?? null,
          userAvatar: user?.avatarUrl ?? user?.image ?? null,
        };
      })
    );

    return commentsWithUsers;
  },
});

// Internal: Create a comment (called from HTTP action)
export const createInternal = internalMutation({
  args: {
    postId: v.id("posts"),
    apiKeyId: v.id("apiKeys"),
    userId: v.id("users"),
    content: v.string(),
  },
  returns: v.id("comments"),
  handler: async (ctx, args) => {
    // Verify the post exists and is published
    const post = await ctx.db.get(args.postId);
    if (!post || post.isDeleted) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Post not found" });
    }

    if (post.status !== "approved" && post.status !== "auto_published") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Cannot comment on unpublished posts",
      });
    }

    const now = Date.now();
    const commentId = await ctx.db.insert("comments", {
      postId: args.postId,
      apiKeyId: args.apiKeyId,
      userId: args.userId,
      content: args.content,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    });

    return commentId;
  },
});

// Internal: Get comments for a post (for HTTP actions)
export const listByPostInternal = internalQuery({
  args: { postId: v.id("posts") },
  returns: v.array(
    v.object({
      _id: v.id("comments"),
      content: v.string(),
      createdAt: v.number(),
      likes: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_postId", (q) => q.eq("postId", args.postId))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .order("asc")
      .collect();

    // Get like counts for each comment
    const commentsWithLikes = await Promise.all(
      comments.map(async (c) => {
        const likes = await ctx.db
          .query("commentLikes")
          .withIndex("by_commentId", (q) => q.eq("commentId", c._id))
          .collect();

        return {
          _id: c._id,
          content: c.content,
          createdAt: c.createdAt,
          likes: likes.length,
        };
      })
    );

    return commentsWithLikes;
  },
});

// Internal: Like a comment
export const likeInternal = internalMutation({
  args: {
    commentId: v.id("comments"),
    apiKeyId: v.id("apiKeys"),
    userId: v.id("users"),
  },
  returns: v.object({
    success: v.boolean(),
    alreadyLiked: v.boolean(),
    likes: v.number(),
  }),
  handler: async (ctx, args) => {
    // Verify the comment exists
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.isDeleted) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Comment not found" });
    }

    // Check if already liked by this API key
    const existingLike = await ctx.db
      .query("commentLikes")
      .withIndex("by_commentId_apiKeyId", (q) =>
        q.eq("commentId", args.commentId).eq("apiKeyId", args.apiKeyId)
      )
      .first();

    if (existingLike) {
      // Get current like count
      const likes = await ctx.db
        .query("commentLikes")
        .withIndex("by_commentId", (q) => q.eq("commentId", args.commentId))
        .collect();

      return { success: true, alreadyLiked: true, likes: likes.length };
    }

    // Add the like
    await ctx.db.insert("commentLikes", {
      commentId: args.commentId,
      apiKeyId: args.apiKeyId,
      userId: args.userId,
      createdAt: Date.now(),
    });

    // Get updated like count
    const likes = await ctx.db
      .query("commentLikes")
      .withIndex("by_commentId", (q) => q.eq("commentId", args.commentId))
      .collect();

    return { success: true, alreadyLiked: false, likes: likes.length };
  },
});

// Delete a comment (for post owner)
export const deleteComment = mutation({
  args: { commentId: v.id("comments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Must be logged in",
      });
    }

    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Comment not found" });
    }

    // Get the post to check ownership
    const post = await ctx.db.get(comment.postId);
    if (!post) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Post not found" });
    }

    // Check if user owns the post or the comment
    const userProfile = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", userId))
      .first();

    if (!userProfile) {
      throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    }

    if (post.userId !== userProfile._id && comment.userId !== userProfile._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Not authorized to delete this comment",
      });
    }

    await ctx.db.patch(args.commentId, {
      isDeleted: true,
      updatedAt: Date.now(),
    });

    return null;
  },
});
