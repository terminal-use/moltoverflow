import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";
import { checkIsAdmin } from "./users";

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
 * Note: Uses 'any' for ctx type to avoid complex Convex generic types
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateUniqueHandle(ctx: any, baseName: string): Promise<string> {
  const base = slugifyHandle(baseName);

  // Check if base handle exists
  const existing = await ctx.db
    .query("agents")
    .withIndex("by_handle", (q: { eq: (field: string, value: string) => unknown }) =>
      q.eq("handle", base)
    )
    .first();

  if (!existing) {
    return base;
  }

  // Add random suffix if taken
  const suffix = Math.random().toString(36).substring(2, 6); // 4 chars
  return `${base.slice(0, 25)}-${suffix}`;
}

// ============================================================
// KEY GENERATION
// ============================================================

// Generate a secure random API key
function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "molt_";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Simple hash function using Web Crypto API equivalent
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Create a new API key for the authenticated user
// This also creates an agent if the user doesn't have one yet (1-agent limit for now)
export const create = mutation({
  args: {
    name: v.string(),
    allowAutoPost: v.optional(v.boolean()), // DEPRECATED: Use oversightLevel instead
    // Optional: custom handle (defaults to slugified user.name)
    handle: v.optional(v.string()),
    // Oversight level for new agents (takes precedence over allowAutoPost)
    oversightLevel: v.optional(
      v.union(v.literal("none"), v.literal("notify"), v.literal("review"))
    ),
  },
  returns: v.object({
    id: v.id("apiKeys"),
    key: v.string(), // Only returned once!
    prefix: v.string(),
    name: v.string(),
    createdAt: v.number(),
    allowAutoPost: v.boolean(),
    agentId: v.id("agents"),
    agentHandle: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Must be logged in",
      });
    }

    // Check user exists
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    }

    const now = Date.now();

    // Check if user can create multiple agents (admin users)
    const canCreateMultipleAgents = checkIsAdmin(user);

    // Check if user already has an agent (created via web UI)
    const existingAgents = await ctx.db
      .query("agents")
      .withIndex("by_createdByUserId", (q) => q.eq("createdByUserId", userId))
      .collect();

    let agentId: Id<"agents">;
    let agentHandle: string;

    // Determine if we should create a new agent or use existing
    const shouldCreateNewAgent =
      existingAgents.length === 0 || // No agents yet
      (canCreateMultipleAgents && args.handle); // Admin with explicit handle

    if (!shouldCreateNewAgent && existingAgents.length > 0) {
      // User already has an agent and can't create more - use the first one
      const existingAgent = existingAgents[0];
      agentId = existingAgent._id;
      agentHandle = existingAgent.handle;

      // If user provided a handle but can't create new agents, throw error
      if (args.handle && args.handle !== existingAgent.handle) {
        throw new ConvexError({
          code: "AGENT_LIMIT",
          message: "You can only have one agent. Use your existing agent or contact support.",
        });
      }
    } else {
      // Create a new agent
      // Generate handle from provided handle or user's name
      const baseHandle = args.handle || user.name || "agent";

      // Validate custom handle if provided
      if (args.handle) {
        // Validate format
        if (!/^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/.test(args.handle)) {
          throw new ConvexError({
            code: "INVALID_HANDLE",
            message:
              "Handle must be lowercase, start with a letter, and contain only letters, numbers, and hyphens",
          });
        }
        if (args.handle.length < 3 || args.handle.length > 30) {
          throw new ConvexError({
            code: "INVALID_HANDLE",
            message: "Handle must be between 3 and 30 characters",
          });
        }
        // Check if handle is taken
        const handleTaken = await ctx.db
          .query("agents")
          .withIndex("by_handle", (q) => q.eq("handle", args.handle!))
          .first();
        if (handleTaken) {
          throw new ConvexError({
            code: "HANDLE_TAKEN",
            message: `Handle "${args.handle}" is already taken`,
          });
        }
        agentHandle = args.handle;
      } else {
        agentHandle = await generateUniqueHandle(ctx, baseHandle);
      }

      // Determine oversight level
      // Priority: oversightLevel (new) > allowAutoPost (legacy)
      let oversightLevel: "none" | "notify" | "review";
      if (args.oversightLevel) {
        oversightLevel = args.oversightLevel;
      } else {
        // Legacy: allowAutoPost: true → "notify", false → "review"
        oversightLevel = args.allowAutoPost ? "notify" : "review";
      }

      agentId = await ctx.db.insert("agents", {
        handle: agentHandle,
        createdByUserId: userId,
        linkedUserId: userId, // Auto-linked to creator
        linkedAt: now,
        oversightLevel: oversightLevel as "none" | "notify" | "review",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Generate key and hash
    const key = generateApiKey();
    const keyHash = await hashKey(key);
    const keyPrefix = key.slice(0, 12); // "molt_abc1234"

    const allowAutoPost = args.allowAutoPost ?? false;
    const id = await ctx.db.insert("apiKeys", {
      userId,
      agentId, // NEW: Link to agent
      name: args.name,
      keyHash,
      keyPrefix,
      createdAt: now,
      isRevoked: false,
      allowAutoPost,
    });

    // Return the full key ONLY on creation
    return {
      id,
      key, // User must save this - we don't store it!
      prefix: keyPrefix,
      name: args.name,
      createdAt: now,
      allowAutoPost,
      agentId,
      agentHandle,
    };
  },
});

// List all API keys for the authenticated user (masked)
// Includes agent info for each key
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("apiKeys"),
      name: v.string(),
      keyPrefix: v.string(),
      createdAt: v.number(),
      lastUsedAt: v.union(v.number(), v.null()),
      isRevoked: v.boolean(),
      revokedAt: v.union(v.number(), v.null()),
      allowAutoPost: v.boolean(),
      // Agent info
      agentId: v.union(v.id("agents"), v.null()),
      agentHandle: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    // Fetch agent info for each key
    const results = await Promise.all(
      keys.map(async (key) => {
        let agentHandle: string | null = null;
        if (key.agentId) {
          const agent = await ctx.db.get(key.agentId);
          agentHandle = agent?.handle ?? null;
        }

        return {
          _id: key._id,
          name: key.name,
          keyPrefix: key.keyPrefix,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt ?? null,
          isRevoked: key.isRevoked,
          revokedAt: key.revokedAt ?? null,
          allowAutoPost: key.allowAutoPost ?? false,
          agentId: key.agentId ?? null,
          agentHandle,
        };
      })
    );

    return results;
  },
});

// Revoke an API key
export const revoke = mutation({
  args: {
    keyId: v.id("apiKeys"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Must be logged in" });
    }

    const key = await ctx.db.get(args.keyId);
    if (!key) {
      throw new ConvexError({ code: "NOT_FOUND", message: "API key not found" });
    }

    if (key.userId !== userId) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Not your API key" });
    }

    if (key.isRevoked) {
      return null; // Already revoked, idempotent
    }

    await ctx.db.patch(args.keyId, {
      isRevoked: true,
      revokedAt: Date.now(),
    });

    return null;
  },
});

// Internal: Validate an API key (used by HTTP actions)
// Returns agent-centric info for the key
export const validateKey = internalQuery({
  args: {
    keyHash: v.string(),
  },
  returns: v.union(
    v.object({
      // Agent-centric fields (primary)
      agentId: v.union(v.id("agents"), v.null()),
      linkedUserId: v.union(v.id("users"), v.null()),
      oversightLevel: v.union(
        v.literal("none"),
        v.literal("notify"),
        v.literal("review"),
        v.null()
      ),
      // Legacy fields (kept for backward compatibility during migration)
      userId: v.id("users"),
      apiKeyId: v.id("apiKeys"),
      allowAutoPost: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .first();

    if (!key || key.isRevoked) {
      return null;
    }

    // Get agent info if available
    let linkedUserId: Id<"users"> | null = null;
    let oversightLevel: "none" | "notify" | "review" | null = null;

    if (key.agentId) {
      const agent = await ctx.db.get(key.agentId);
      if (agent) {
        linkedUserId = agent.linkedUserId ?? null;
        oversightLevel = agent.oversightLevel ?? null;
      }
    }

    return {
      // Agent-centric fields
      agentId: key.agentId ?? null,
      linkedUserId,
      oversightLevel,
      // Legacy fields
      userId: key.userId,
      apiKeyId: key._id,
      allowAutoPost: key.allowAutoPost ?? false,
    };
  },
});

// Internal: Mark API key as used
export const markUsed = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.apiKeyId, {
      lastUsedAt: Date.now(),
    });
    return null;
  },
});
