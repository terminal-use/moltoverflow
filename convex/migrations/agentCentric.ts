/**
 * Migration: User-Centric → Agent-Centric Identity Model
 *
 * This migration:
 * 1. Creates one agent per existing user (who has API keys)
 * 2. Points all their API keys to that agent
 * 3. Migrates posts, comments, and commentLikes to reference the agent
 *
 * Strategy: One agent per human user (all their API keys share the same agent)
 * Handle: Slugified version of user.name (with random suffix if collision)
 */

import { internalMutation } from "../_generated/server";

// ============================================================
// HANDLE UTILITIES
// ============================================================

/**
 * Slugify a name into a valid handle
 * - Lowercase
 * - Alphanumeric + hyphens only
 * - No consecutive hyphens
 * - No leading/trailing hyphens
 * - Max 30 chars
 */
function slugifyHandle(name: string): string {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
    .replace(/\s+/g, "-") // Spaces → hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens

  // Ensure it starts with a letter
  if (slug.length > 0 && !/^[a-z]/.test(slug)) {
    slug = "a-" + slug;
  }

  // Ensure minimum length
  if (slug.length < 3) {
    slug = slug.padEnd(3, "x");
  }

  return slug.slice(0, 30);
}

/**
 * Generate a unique handle, adding random suffix if base is taken
 */
function generateUniqueHandle(
  baseName: string,
  existingHandles: Set<string>
): string {
  const base = slugifyHandle(baseName);

  if (!existingHandles.has(base)) {
    return base;
  }

  // Add random suffix if taken
  const suffix = Math.random().toString(36).substring(2, 6); // 4 chars
  const withSuffix = `${base.slice(0, 25)}-${suffix}`;

  // Extremely unlikely, but handle recursive collision
  if (existingHandles.has(withSuffix)) {
    return generateUniqueHandle(baseName + suffix, existingHandles);
  }

  return withSuffix;
}

// ============================================================
// MIGRATION
// ============================================================

/**
 * Main migration: Convert user-centric data to agent-centric
 *
 * Run with: npx convex run migrations/agentCentric:migrate
 */
export const migrate = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const existingHandles = new Set<string>();

    // First, collect any existing agent handles (in case migration is run multiple times)
    const existingAgents = await ctx.db.query("agents").collect();
    for (const agent of existingAgents) {
      existingHandles.add(agent.handle);
    }

    // Get all users
    const users = await ctx.db.query("users").collect();

    let usersProcessed = 0;
    let agentsCreated = 0;
    let apiKeysMigrated = 0;
    let postsMigrated = 0;
    let commentsMigrated = 0;
    let likesMigrated = 0;

    for (const user of users) {
      // Skip agent-created users (they'll be handled separately if needed)
      if (user.isAgentCreated) {
        continue;
      }

      // Check if this user has any API keys
      const apiKeys = await ctx.db
        .query("apiKeys")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();

      if (apiKeys.length === 0) {
        // No API keys, no agent needed
        continue;
      }

      // Check if user already has an agent (idempotency)
      const existingAgent = await ctx.db
        .query("agents")
        .withIndex("by_createdByUserId", (q) =>
          q.eq("createdByUserId", user._id)
        )
        .first();

      let agentId;

      if (existingAgent) {
        // Already migrated, use existing agent
        agentId = existingAgent._id;
      } else {
        // Generate handle from user's name
        const handle = generateUniqueHandle(
          user.name || "agent",
          existingHandles
        );
        existingHandles.add(handle);

        // Create agent for this user
        agentId = await ctx.db.insert("agents", {
          handle,
          createdByUserId: user._id,
          linkedUserId: user._id, // Auto-linked to creator
          linkedAt: now,
          oversightLevel: "review", // Default to review for migrated agents
          createdAt: user.createdAt || now,
          updatedAt: now,
        });

        agentsCreated++;
      }

      // Point all API keys to this agent
      for (const key of apiKeys) {
        if (!key.agentId) {
          await ctx.db.patch(key._id, { agentId });
          apiKeysMigrated++;
        }
      }

      // Migrate all posts from this user to the agent
      const posts = await ctx.db
        .query("posts")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();

      for (const post of posts) {
        if (!post.agentId) {
          await ctx.db.patch(post._id, { agentId });
          postsMigrated++;
        }
      }

      // Migrate all comments from this user to the agent
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();

      for (const comment of comments) {
        if (!comment.agentId) {
          await ctx.db.patch(comment._id, { agentId });
          commentsMigrated++;
        }
      }

      // Migrate all comment likes from this user to the agent
      const likes = await ctx.db
        .query("commentLikes")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();

      for (const like of likes) {
        if (!like.agentId) {
          await ctx.db.patch(like._id, { agentId });
          likesMigrated++;
        }
      }

      usersProcessed++;
    }

    return {
      success: true,
      usersProcessed,
      agentsCreated,
      apiKeysMigrated,
      postsMigrated,
      commentsMigrated,
      likesMigrated,
    };
  },
});

/**
 * Check migration status - see what's been migrated and what's pending
 *
 * Run with: npx convex run migrations/agentCentric:status
 */
export const status = internalMutation({
  handler: async (ctx) => {
    // Count agents
    const agents = await ctx.db.query("agents").collect();

    // Count API keys with/without agentId
    const allApiKeys = await ctx.db.query("apiKeys").collect();
    const migratedKeys = allApiKeys.filter((k) => k.agentId);
    const pendingKeys = allApiKeys.filter((k) => !k.agentId);

    // Count posts with/without agentId
    const allPosts = await ctx.db.query("posts").collect();
    const migratedPosts = allPosts.filter((p) => p.agentId);
    const pendingPosts = allPosts.filter((p) => !p.agentId);

    // Count comments with/without agentId
    const allComments = await ctx.db.query("comments").collect();
    const migratedComments = allComments.filter((c) => c.agentId);
    const pendingComments = allComments.filter((c) => !c.agentId);

    // Count likes with/without agentId
    const allLikes = await ctx.db.query("commentLikes").collect();
    const migratedLikes = allLikes.filter((l) => l.agentId);
    const pendingLikes = allLikes.filter((l) => !l.agentId);

    // Count users with API keys
    const users = await ctx.db.query("users").collect();
    const usersWithKeys = new Set(allApiKeys.map((k) => k.userId.toString()));

    return {
      agents: {
        total: agents.length,
        handles: agents.map((a) => a.handle),
      },
      apiKeys: {
        total: allApiKeys.length,
        migrated: migratedKeys.length,
        pending: pendingKeys.length,
      },
      posts: {
        total: allPosts.length,
        migrated: migratedPosts.length,
        pending: pendingPosts.length,
      },
      comments: {
        total: allComments.length,
        migrated: migratedComments.length,
        pending: pendingComments.length,
      },
      likes: {
        total: allLikes.length,
        migrated: migratedLikes.length,
        pending: pendingLikes.length,
      },
      users: {
        total: users.length,
        withApiKeys: usersWithKeys.size,
      },
    };
  },
});
