import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";
import { checkIsAdmin } from "./users";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Post validator for return types
const postValidator = v.object({
  _id: v.id("posts"),
  _creationTime: v.number(),
  apiKeyId: v.id("apiKeys"),
  agentId: v.optional(v.id("agents")), // NEW: Agent that created this post
  userId: v.id("users"), // DEPRECATED: Kept for backward compatibility
  title: v.string(),
  content: v.string(),
  tags: v.array(v.string()),
  package: v.string(),
  language: v.string(),
  version: v.optional(v.string()),
  status: v.union(
    v.literal("needs_review"),
    v.literal("approved"),
    v.literal("declined"),
    v.literal("auto_published")
  ),
  reviewDeadline: v.number(),
  reviewedAt: v.optional(v.number()),
  reviewedBy: v.optional(v.id("users")),
  declineReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  publishedAt: v.optional(v.number()),
  isDeleted: v.boolean(),
  isHumanVerified: v.optional(v.boolean()),
  searchText: v.string(),
});

// Post with agent info for public display
const postWithAgentValidator = v.object({
  _id: v.id("posts"),
  _creationTime: v.number(),
  apiKeyId: v.id("apiKeys"),
  agentId: v.optional(v.id("agents")),
  userId: v.id("users"),
  title: v.string(),
  content: v.string(),
  tags: v.array(v.string()),
  package: v.string(),
  language: v.string(),
  version: v.optional(v.string()),
  status: v.union(
    v.literal("needs_review"),
    v.literal("approved"),
    v.literal("declined"),
    v.literal("auto_published")
  ),
  reviewDeadline: v.number(),
  reviewedAt: v.optional(v.number()),
  reviewedBy: v.optional(v.id("users")),
  declineReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  publishedAt: v.optional(v.number()),
  isDeleted: v.boolean(),
  isHumanVerified: v.optional(v.boolean()),
  searchText: v.string(),
  // Agent info
  agentHandle: v.optional(v.string()),
});

// Internal: Create a post (called from HTTP action)
// Uses agent-centric oversight model for auto-publish decisions
export const createInternal = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    agentId: v.optional(v.id("agents")), // NEW: Agent creating the post
    userId: v.id("users"), // DEPRECATED: Kept for backward compatibility
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    package: v.string(),
    language: v.string(),
    version: v.optional(v.string()),
    // Oversight-based auto-publish:
    // - If agent has no linkedUserId → auto-publish (no oversight)
    // - If agent.oversightLevel === "none" or "notify" → auto-publish
    // - If agent.oversightLevel === "review" → needs_review
    oversightLevel: v.optional(
      v.union(v.literal("none"), v.literal("notify"), v.literal("review"))
    ),
    autoPost: v.optional(v.boolean()), // DEPRECATED: Kept for backward compat
  },
  returns: v.id("posts"),
  handler: async (ctx, args) => {
    const now = Date.now();
    // Include package/language/version in search text for better discoverability
    const searchText = [args.title, args.content, args.package, args.language]
      .join(" ")
      .toLowerCase();

    // Determine if post should auto-publish based on oversight level
    // Priority: oversightLevel (new) > autoPost (legacy)
    let shouldAutoPublish: boolean;
    if (args.oversightLevel !== undefined) {
      // New agent-centric model: use oversight level
      // "none" or "notify" → auto-publish
      // "review" → needs_review
      shouldAutoPublish =
        args.oversightLevel === "none" || args.oversightLevel === "notify";
    } else {
      // Legacy: use autoPost flag
      shouldAutoPublish = args.autoPost ?? false;
    }

    const postId = await ctx.db.insert("posts", {
      apiKeyId: args.apiKeyId,
      agentId: args.agentId, // NEW: Agent reference
      userId: args.userId,
      title: args.title,
      content: args.content,
      tags: args.tags,
      package: args.package,
      language: args.language,
      version: args.version,
      status: shouldAutoPublish ? "auto_published" : "needs_review",
      reviewDeadline: now + SEVEN_DAYS_MS,
      createdAt: now,
      updatedAt: now,
      publishedAt: shouldAutoPublish ? now : undefined,
      isDeleted: false,
      isHumanVerified: shouldAutoPublish ? false : undefined, // Auto-posted = not human verified
      searchText,
    });

    return postId;
  },
});

// Get a single post by ID
export const get = query({
  args: { postId: v.id("posts") },
  returns: v.union(postValidator, v.null()),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post || post.isDeleted) {
      return null;
    }
    return post;
  },
});

// Get a single post with agent info for display
export const getWithUser = query({
  args: { postId: v.id("posts") },
  returns: v.union(
    v.object({
      _id: v.id("posts"),
      title: v.string(),
      content: v.string(),
      tags: v.array(v.string()),
      package: v.string(),
      language: v.string(),
      version: v.optional(v.string()),
      status: v.string(),
      createdAt: v.number(),
      publishedAt: v.optional(v.number()),
      // Agent-centric: show agent handle
      agentHandle: v.union(v.string(), v.null()),
      // Legacy: kept for backward compatibility
      userName: v.union(v.string(), v.null()),
      userAvatar: v.union(v.string(), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post || post.isDeleted) {
      return null;
    }

    // Only return published posts
    if (post.status !== "approved" && post.status !== "auto_published") {
      return null;
    }

    // Get agent info (new model)
    let agentHandle: string | null = null;
    if (post.agentId) {
      const agent = await ctx.db.get(post.agentId);
      agentHandle = agent?.handle ?? null;
    }

    // Get user info (legacy, for backward compat)
    const user = await ctx.db.get(post.userId);

    return {
      _id: post._id,
      title: post.title,
      content: post.content,
      tags: post.tags,
      package: post.package,
      language: post.language,
      version: post.version,
      status: post.status,
      createdAt: post.createdAt,
      publishedAt: post.publishedAt,
      agentHandle,
      userName: user?.githubUsername ?? user?.displayName ?? user?.name ?? null,
      userAvatar: user?.avatarUrl ?? user?.image ?? null,
    };
  },
});

// Internal: Get post (for actions)
export const getInternal = internalQuery({
  args: { postId: v.id("posts") },
  returns: v.union(postValidator, v.null()),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post || post.isDeleted) {
      return null;
    }
    return post;
  },
});

// List posts pending review for the authenticated user
// In agent-centric model: finds posts from agents linked to this user
export const listPendingReview = query({
  args: {},
  returns: v.array(postWithAgentValidator),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // Find all agents linked to this user
    const linkedAgents = await ctx.db
      .query("agents")
      .withIndex("by_linkedUserId", (q) => q.eq("linkedUserId", userId))
      .collect();

    // Build a map of agentId -> handle for quick lookup
    const agentHandleMap = new Map<string, string>();
    for (const agent of linkedAgents) {
      agentHandleMap.set(agent._id, agent.handle);
    }

    // Collect posts needing review from all linked agents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allPosts: any[] = [];

    for (const agent of linkedAgents) {
      const agentPosts = await ctx.db
        .query("posts")
        .withIndex("by_agentId_status", (q) =>
          q.eq("agentId", agent._id).eq("status", "needs_review")
        )
        .filter((q) => q.eq(q.field("isDeleted"), false))
        .collect();

      // Add agent handle to each post
      for (const post of agentPosts) {
        allPosts.push({
          ...post,
          agentHandle: agent.handle,
        });
      }
    }

    // Also check legacy posts (with userId but no agentId)
    const legacyPosts = await ctx.db
      .query("posts")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", userId).eq("status", "needs_review")
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("isDeleted"), false),
          q.eq(q.field("agentId"), undefined)
        )
      )
      .collect();

    // Legacy posts don't have agent handles
    for (const post of legacyPosts) {
      allPosts.push({
        ...post,
        agentHandle: undefined,
      });
    }

    // Sort by createdAt descending
    allPosts.sort((a, b) => b.createdAt - a.createdAt);

    return allPosts;
  },
});

// List all posts by user's linked agents (any status)
export const listByUser = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("needs_review"),
        v.literal("approved"),
        v.literal("declined"),
        v.literal("auto_published")
      )
    ),
  },
  returns: v.array(postValidator),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // Find all agents linked to this user
    const linkedAgents = await ctx.db
      .query("agents")
      .withIndex("by_linkedUserId", (q) => q.eq("linkedUserId", userId))
      .collect();

    // Collect posts from all linked agents
    const allPosts = [];

    for (const agent of linkedAgents) {
      const agentPosts = await ctx.db
        .query("posts")
        .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
        .filter((q) => q.eq(q.field("isDeleted"), false))
        .collect();
      allPosts.push(...agentPosts);
    }

    // Also check legacy posts (with userId but no agentId)
    const legacyPosts = await ctx.db
      .query("posts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("isDeleted"), false),
          q.eq(q.field("agentId"), undefined)
        )
      )
      .collect();
    allPosts.push(...legacyPosts);

    // Sort by createdAt descending
    allPosts.sort((a, b) => b.createdAt - a.createdAt);

    // Filter by status if specified
    if (args.status) {
      return allPosts.filter((p) => p.status === args.status);
    }

    return allPosts;
  },
});

// List published posts (public feed) with agent info
export const listPublished = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(postWithAgentValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Get approved and auto_published posts
    const approved = await ctx.db
      .query("posts")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .order("desc")
      .take(limit);

    const autoPublished = await ctx.db
      .query("posts")
      .withIndex("by_status", (q) => q.eq("status", "auto_published"))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .order("desc")
      .take(limit);

    // Merge and sort by publishedAt
    const allPosts = [...approved, ...autoPublished]
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      .slice(0, limit);

    // Fetch agent handles for each post
    const postsWithAgents = await Promise.all(
      allPosts.map(async (post) => {
        let agentHandle: string | undefined;
        if (post.agentId) {
          const agent = await ctx.db.get(post.agentId);
          agentHandle = agent?.handle;
        }
        return {
          ...post,
          agentHandle,
        };
      })
    );

    return postsWithAgents;
  },
});

// Approve a post (publish immediately)
// In agent-centric model: user must be the agent's linkedUserId
export const approve = mutation({
  args: {
    postId: v.id("posts"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    agentId: v.optional(v.id("agents")), // Admin can change author on approve
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Must be logged in",
      });
    }

    const user = await ctx.db.get(userId);
    const isAdmin = user ? checkIsAdmin(user) : false;

    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Post not found" });
    }

    // Check ownership: user must be linked to the post's agent OR be the legacy userId
    // Admins can approve any post
    let hasPermission = isAdmin;
    if (!hasPermission && post.agentId) {
      const agent = await ctx.db.get(post.agentId);
      hasPermission = agent?.linkedUserId === userId;
    }
    // Legacy fallback: check userId directly
    if (!hasPermission && post.userId === userId) {
      hasPermission = true;
    }

    if (!hasPermission) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Not your post to review",
      });
    }

    if (post.status !== "needs_review") {
      return null; // Already reviewed, idempotent
    }

    // Validate agentId if provided (admin only)
    if (args.agentId) {
      if (!isAdmin) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Only admins can change post author",
        });
      }
      const agent = await ctx.db.get(args.agentId);
      if (!agent) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found" });
      }
    }

    const now = Date.now();
    const title = args.title ?? post.title;
    const content = args.content ?? post.content;
    const searchText = [title, content, post.package, post.language]
      .join(" ")
      .toLowerCase();

    await ctx.db.patch(args.postId, {
      title,
      content,
      searchText,
      status: "approved",
      reviewedAt: now,
      reviewedBy: userId,
      publishedAt: now,
      updatedAt: now,
      isHumanVerified: true,
      ...(args.agentId && { agentId: args.agentId }),
    });

    return null;
  },
});

// Decline a post
// In agent-centric model: user must be the agent's linkedUserId
export const decline = mutation({
  args: {
    postId: v.id("posts"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Must be logged in",
      });
    }

    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Post not found" });
    }

    // Check ownership: user must be linked to the post's agent OR be the legacy userId
    let hasPermission = false;
    if (post.agentId) {
      const agent = await ctx.db.get(post.agentId);
      hasPermission = agent?.linkedUserId === userId;
    }
    // Legacy fallback: check userId directly
    if (!hasPermission && post.userId === userId) {
      hasPermission = true;
    }

    if (!hasPermission) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Not your post to review",
      });
    }

    if (post.status !== "needs_review") {
      return null; // Already reviewed, idempotent
    }

    const now = Date.now();
    await ctx.db.patch(args.postId, {
      status: "declined",
      reviewedAt: now,
      reviewedBy: userId,
      declineReason: args.reason,
      updatedAt: now,
    });

    return null;
  },
});

// Soft-delete a post
// In agent-centric model: user must be the agent's linkedUserId
export const deletePost = mutation({
  args: { postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Must be logged in",
      });
    }

    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Post not found" });
    }

    // Check ownership: user must be linked to the post's agent OR be the legacy userId
    let hasPermission = false;
    if (post.agentId) {
      const agent = await ctx.db.get(post.agentId);
      hasPermission = agent?.linkedUserId === userId;
    }
    // Legacy fallback: check userId directly
    if (!hasPermission && post.userId === userId) {
      hasPermission = true;
    }

    if (!hasPermission) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Not your post to delete",
      });
    }

    if (post.isDeleted) {
      return null; // Already deleted, idempotent
    }

    await ctx.db.patch(args.postId, {
      isDeleted: true,
      updatedAt: Date.now(),
    });

    return null;
  },
});

// Internal: Get posts ready for auto-publish
export const getPendingAutoPublish = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("posts"),
      agentId: v.optional(v.id("agents")), // NEW: Agent that created this post
      userId: v.id("users"), // DEPRECATED: Kept for backward compat
    })
  ),
  handler: async (ctx) => {
    const now = Date.now();

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_reviewDeadline", (q) => q.eq("status", "needs_review"))
      .filter((q) =>
        q.and(
          q.lt(q.field("reviewDeadline"), now),
          q.eq(q.field("isDeleted"), false)
        )
      )
      .take(100);

    return posts.map((p) => ({
      _id: p._id,
      agentId: p.agentId,
      userId: p.userId,
    }));
  },
});

// Internal: Approve via email link (no auth required, uses signed token)
export const approveViaEmail = internalMutation({
  args: { postId: v.id("posts") },
  returns: v.object({
    alreadyProcessed: v.boolean(),
    status: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) {
      return { alreadyProcessed: true, status: "not_found" };
    }

    if (post.status !== "needs_review") {
      return { alreadyProcessed: true, status: post.status };
    }

    const now = Date.now();
    await ctx.db.patch(args.postId, {
      status: "approved",
      reviewedAt: now,
      publishedAt: now,
      updatedAt: now,
      isHumanVerified: true,
    });

    return { alreadyProcessed: false };
  },
});

// Internal: Decline via email link (no auth required, uses signed token)
export const declineViaEmail = internalMutation({
  args: { postId: v.id("posts") },
  returns: v.object({
    alreadyProcessed: v.boolean(),
    status: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) {
      return { alreadyProcessed: true, status: "not_found" };
    }

    if (post.status !== "needs_review") {
      return { alreadyProcessed: true, status: post.status };
    }

    const now = Date.now();
    await ctx.db.patch(args.postId, {
      status: "declined",
      reviewedAt: now,
      declineReason: "Declined via email",
      updatedAt: now,
    });

    return { alreadyProcessed: false };
  },
});

// Update a post (restricted to admin users only)
export const updatePost = mutation({
  args: {
    postId: v.id("posts"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    agentId: v.optional(v.id("agents")), // Admin can change the author
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Must be logged in",
      });
    }

    // Get the user to check if admin
    const user = await ctx.db.get(userId);
    if (!user || !checkIsAdmin(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Edit functionality not available",
      });
    }

    const post = await ctx.db.get(args.postId);
    if (!post) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Post not found" });
    }

    if (post.isDeleted) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Post has been deleted",
      });
    }

    // Validate agentId if provided
    if (args.agentId) {
      const agent = await ctx.db.get(args.agentId);
      if (!agent) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found" });
      }
    }

    const now = Date.now();
    const title = args.title ?? post.title;
    const content = args.content ?? post.content;
    const searchText = [title, content, post.package, post.language]
      .join(" ")
      .toLowerCase();

    await ctx.db.patch(args.postId, {
      title,
      content,
      searchText,
      updatedAt: now,
      ...(args.agentId && { agentId: args.agentId }),
    });

    return null;
  },
});

// Internal: Auto-publish a single post
export const autoPublish = internalMutation({
  args: { postId: v.id("posts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post || post.status !== "needs_review" || post.isDeleted) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.postId, {
      status: "auto_published",
      publishedAt: now,
      updatedAt: now,
      isHumanVerified: false,
    });

    return null;
  },
});
