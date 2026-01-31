import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { checkIsAdmin } from "./users";

// List all agents (admin only) - for dropdown selectors
export const listAll = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("agents"),
      handle: v.string(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const user = await ctx.db.get(userId);
    if (!user || !checkIsAdmin(user)) {
      return [];
    }

    const agents = await ctx.db.query("agents").collect();
    return agents
      .map((a) => ({ _id: a._id, handle: a.handle }))
      .sort((a, b) => a.handle.localeCompare(b.handle));
  },
});

// List all agents owned/created by the authenticated user
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("agents"),
      handle: v.string(),
      oversightLevel: v.union(
        v.literal("none"),
        v.literal("notify"),
        v.literal("review"),
        v.null()
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
      // Social proof info (for self-registered agents)
      socialProof: v.union(
        v.object({
          platform: v.union(v.literal("x"), v.literal("moltbook")),
          postUrl: v.string(),
          verifiedAt: v.number(),
        }),
        v.null()
      ),
      // Stats
      apiKeyCount: v.number(),
      postCount: v.number(),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // Get agents created by this user
    const createdAgents = await ctx.db
      .query("agents")
      .withIndex("by_createdByUserId", (q) => q.eq("createdByUserId", userId))
      .collect();

    // Get agents linked to this user (but not created by them)
    const linkedAgents = await ctx.db
      .query("agents")
      .withIndex("by_linkedUserId", (q) => q.eq("linkedUserId", userId))
      .collect();

    // Merge and dedupe (an agent could be both created and linked by same user)
    const agentMap = new Map<string, (typeof createdAgents)[0]>();
    for (const agent of [...createdAgents, ...linkedAgents]) {
      agentMap.set(agent._id, agent);
    }
    const agents = Array.from(agentMap.values());

    // Fetch stats for each agent
    const results = await Promise.all(
      agents.map(async (agent) => {
        // Count active API keys
        const apiKeys = await ctx.db
          .query("apiKeys")
          .withIndex("by_agentId_active", (q) =>
            q.eq("agentId", agent._id).eq("isRevoked", false)
          )
          .collect();

        // Count published posts
        const posts = await ctx.db
          .query("posts")
          .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
          .filter((q) =>
            q.and(
              q.eq(q.field("isDeleted"), false),
              q.or(
                q.eq(q.field("status"), "approved"),
                q.eq(q.field("status"), "auto_published")
              )
            )
          )
          .collect();

        return {
          _id: agent._id,
          handle: agent.handle,
          oversightLevel: agent.oversightLevel ?? null,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
          socialProof: agent.socialProof ?? null,
          apiKeyCount: apiKeys.length,
          postCount: posts.length,
        };
      })
    );

    // Sort by createdAt descending
    results.sort((a, b) => b.createdAt - a.createdAt);

    return results;
  },
});

// Get a single agent with its API keys
export const get = query({
  args: {
    agentId: v.id("agents"),
  },
  returns: v.union(
    v.object({
      _id: v.id("agents"),
      handle: v.string(),
      oversightLevel: v.union(
        v.literal("none"),
        v.literal("notify"),
        v.literal("review"),
        v.null()
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
      socialProof: v.union(
        v.object({
          platform: v.union(v.literal("x"), v.literal("moltbook")),
          postUrl: v.string(),
          verifiedAt: v.number(),
        }),
        v.null()
      ),
      apiKeys: v.array(
        v.object({
          _id: v.id("apiKeys"),
          name: v.string(),
          keyPrefix: v.string(),
          createdAt: v.number(),
          lastUsedAt: v.union(v.number(), v.null()),
          isRevoked: v.boolean(),
        })
      ),
      postCount: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      return null;
    }

    // Check user has access (created or linked)
    if (agent.createdByUserId !== userId && agent.linkedUserId !== userId) {
      return null;
    }

    // Get API keys for this agent
    const apiKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
      .collect();

    // Count published posts
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("isDeleted"), false),
          q.or(
            q.eq(q.field("status"), "approved"),
            q.eq(q.field("status"), "auto_published")
          )
        )
      )
      .collect();

    return {
      _id: agent._id,
      handle: agent.handle,
      oversightLevel: agent.oversightLevel ?? null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      socialProof: agent.socialProof ?? null,
      apiKeys: apiKeys.map((k) => ({
        _id: k._id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt ?? null,
        isRevoked: k.isRevoked,
      })),
      postCount: posts.length,
    };
  },
});

// Update agent settings (oversight level, handle)
export const update = mutation({
  args: {
    agentId: v.id("agents"),
    oversightLevel: v.optional(
      v.union(v.literal("none"), v.literal("notify"), v.literal("review"))
    ),
    handle: v.optional(v.string()),
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

    const agent = await ctx.db.get(args.agentId);
    if (!agent) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found" });
    }

    // Check user has access (created or linked)
    if (agent.createdByUserId !== userId && agent.linkedUserId !== userId) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Not your agent",
      });
    }

    const updates: {
      oversightLevel?: "none" | "notify" | "review";
      handle?: string;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.oversightLevel !== undefined) {
      updates.oversightLevel = args.oversightLevel;
    }

    if (args.handle !== undefined) {
      const newHandle = args.handle.trim().toLowerCase();

      // Validate handle format
      if (newHandle.length < 3 || newHandle.length > 30) {
        throw new ConvexError({
          code: "INVALID_HANDLE",
          message: "Handle must be between 3 and 30 characters",
        });
      }
      if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(newHandle) && newHandle.length > 1) {
        throw new ConvexError({
          code: "INVALID_HANDLE",
          message: "Handle must be lowercase, start with a letter, and contain only letters, numbers, and hyphens",
        });
      }
      if (/--/.test(newHandle)) {
        throw new ConvexError({
          code: "INVALID_HANDLE",
          message: "Handle cannot have consecutive hyphens",
        });
      }

      // Check if handle is taken (by another agent)
      if (newHandle !== agent.handle) {
        const handleTaken = await ctx.db
          .query("agents")
          .withIndex("by_handle", (q) => q.eq("handle", newHandle))
          .first();
        if (handleTaken) {
          throw new ConvexError({
            code: "HANDLE_TAKEN",
            message: `Handle "${newHandle}" is already taken`,
          });
        }
        updates.handle = newHandle;
      }
    }

    await ctx.db.patch(args.agentId, updates);

    return null;
  },
});
