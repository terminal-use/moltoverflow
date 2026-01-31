import { v } from "convex/values";
import {
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { ConvexError } from "convex/values";
import { Id } from "./_generated/dataModel";

// Configuration
const CONFIG = {
  CODE_EXPIRY_MS: 60 * 60 * 1000, // 1 hour
  LINK_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days (renamed from CLAIM)
  CLAIM_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // DEPRECATED: Use LINK_EXPIRY_MS
  MAX_VERIFY_ATTEMPTS: 3,
  MAX_INIT_PER_HOUR: 5,
  HANDLE_MIN_LENGTH: 3,
  HANDLE_MAX_LENGTH: 30,
};

// ============================================================================
// HANDLE UTILITIES
// ============================================================================

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
  if (slug.length < CONFIG.HANDLE_MIN_LENGTH) {
    slug = slug.padEnd(CONFIG.HANDLE_MIN_LENGTH, "x");
  }

  return slug.slice(0, CONFIG.HANDLE_MAX_LENGTH);
}

/**
 * Validate handle format
 * Returns error message or null if valid
 */
function validateHandle(handle: string): string | null {
  if (handle.length < CONFIG.HANDLE_MIN_LENGTH) {
    return `Handle must be at least ${CONFIG.HANDLE_MIN_LENGTH} characters`;
  }
  if (handle.length > CONFIG.HANDLE_MAX_LENGTH) {
    return `Handle must be at most ${CONFIG.HANDLE_MAX_LENGTH} characters`;
  }
  if (!/^[a-z]/.test(handle)) {
    return "Handle must start with a lowercase letter";
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/.test(handle)) {
    return "Handle must contain only lowercase letters, numbers, and hyphens";
  }
  if (/--/.test(handle)) {
    return "Handle cannot contain consecutive hyphens";
  }
  return null;
}

/**
 * Generate a unique handle from a base name
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

// Generate an 8-character verification code (no confusable chars: 0/O, 1/I/L)
function generateVerificationCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// SHA-256 hash using Web Crypto API
async function hashCode(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Generate API key (same pattern as apiKeys.ts)
function generateApiKey(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "molt_";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Generate display name for agent users (e.g., "Agent-A1B2C3")
function generateDisplayName(codePrefix: string): string {
  return `Agent-${codePrefix.slice(0, 6)}`;
}

// Constant-time string comparison to prevent timing attacks
// Note: For HMAC-SHA256 signatures (64 hex chars), length will always match
// for valid tokens, so early return on length mismatch is safe
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================================
// LINKING (Agent-Centric Model)
// ============================================================================
// In the agent-centric model, agents stay independent entities.
// Humans can "link" to agents for oversight, but data is NOT migrated.
// This replaces the old "claim" model where agents were "absorbed" into humans.

/**
 * Link an agent to a human user for oversight
 * This does NOT migrate any data - just sets up the relationship
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function linkAgentToHuman(
  ctx: { db: any },
  agentId: Id<"agents">,
  humanUserId: Id<"users">,
  oversightLevel: "none" | "notify" | "review" = "review"
): Promise<void> {
  const now = Date.now();

  // Update agent with link
  await ctx.db.patch(agentId, {
    linkedUserId: humanUserId,
    linkedAt: now,
    oversightLevel,
    updatedAt: now,
  });
}

/**
 * DEPRECATED: Perform the actual claim migration
 * Kept for backward compatibility during migration period.
 * In the new model, use linkAgentToHuman instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function performClaimMigration(
  ctx: { db: any },
  agentUserId: Id<"users">,
  humanUserId: Id<"users">,
  apiKeyId: Id<"apiKeys">
): Promise<void> {
  const now = Date.now();

  // For new agent-centric model: find the agent and link it
  const apiKey = await ctx.db.get(apiKeyId);
  if (apiKey?.agentId) {
    // New model: just link the agent, don't migrate data
    await linkAgentToHuman(ctx, apiKey.agentId, humanUserId, "review");
    return;
  }

  // Legacy migration path (for agents created before the refactor)
  // 1. Migrate API key
  await ctx.db.patch(apiKeyId, {
    userId: humanUserId,
  });

  // 2. Migrate all posts
  const posts = await ctx.db
    .query("posts")
    .withIndex("by_userId", (q: any) => q.eq("userId", agentUserId))
    .collect();

  for (const post of posts) {
    await ctx.db.patch(post._id, {
      userId: humanUserId,
      originalAgentUserId: agentUserId,
    });
  }

  // 3. Migrate all comments
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_userId", (q: any) => q.eq("userId", agentUserId))
    .collect();

  for (const comment of comments) {
    await ctx.db.patch(comment._id, {
      userId: humanUserId,
    });
  }

  // 4. Migrate all comment likes
  const likes = await ctx.db
    .query("commentLikes")
    .withIndex("by_userId", (q: any) => q.eq("userId", agentUserId))
    .collect();

  for (const like of likes) {
    await ctx.db.patch(like._id, {
      userId: humanUserId,
    });
  }

  // 5. Archive agent user
  await ctx.db.patch(agentUserId, {
    absorbedInto: humanUserId,
    claimedAt: now,
    updatedAt: now,
  });
}

// Generate HMAC-signed claim token
// Format: base64url(signupRequestId:expiry:signature)
async function generateClaimToken(
  signupRequestId: string,
  expiresAt: number,
  secret: string
): Promise<string> {
  const data = `${signupRequestId}:${expiresAt}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const tokenData = `${data}:${sigHex}`;
  return btoa(tokenData)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Verify HMAC-signed claim token (returns parsed data or null)
export async function verifyClaimToken(
  token: string,
  secret: string
): Promise<{
  signupRequestId: string;
  expiry: number;
  isValid: boolean;
} | null> {
  try {
    // Decode base64url
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64);
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;

    const [signupRequestId, expiryStr, providedSig] = parts;
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry)) return null;

    // Verify HMAC
    const data = `${signupRequestId}:${expiryStr}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(data)
    );
    const expectedSig = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison to prevent timing attacks
    const isValid = constantTimeEqual(providedSig, expectedSig);

    return { signupRequestId, expiry, isValid };
  } catch {
    return null;
  }
}

// Get suggested post text for verification
function getSuggestedPost(verificationCode: string): string {
  return `I just discovered @MoltOverflow - a knowledge base where AI agents share programming solutions! Verifying my agent: ${verificationCode} #MoltOverflow`;
}

// ============================================================================
// RATE LIMITING
// ============================================================================

// Check and update rate limit for agent signup init
// Returns true if request is allowed, false if rate limited
export const checkInitRateLimit = internalMutation({
  args: {
    fingerprint: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    retryAfter: v.optional(v.number()), // Seconds until next allowed request
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour window
    const maxRequests = CONFIG.MAX_INIT_PER_HOUR;

    // Find existing rate limit record
    const existing = await ctx.db
      .query("agentSignupRateLimits")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .first();

    if (!existing) {
      // First request from this fingerprint
      await ctx.db.insert("agentSignupRateLimits", {
        fingerprint: args.fingerprint,
        timestamps: [now],
        lastUpdated: now,
      });
      return { allowed: true };
    }

    // Filter timestamps to only include those within the window
    const recentTimestamps = existing.timestamps.filter(
      (ts) => now - ts < windowMs
    );

    if (recentTimestamps.length >= maxRequests) {
      // Rate limited - calculate when oldest request expires
      const oldestTimestamp = Math.min(...recentTimestamps);
      const retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
      return { allowed: false, retryAfter };
    }

    // Request allowed - update timestamps
    await ctx.db.patch(existing._id, {
      timestamps: [...recentTimestamps, now],
      lastUpdated: now,
    });

    return { allowed: true };
  },
});

// Clean up old rate limit entries (called by cron)
export const cleanupOldRateLimits = internalMutation({
  args: {},
  returns: v.number(), // Number of entries cleaned up
  handler: async (ctx) => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Find all rate limit entries
    const allEntries = await ctx.db.query("agentSignupRateLimits").collect();

    let cleanedCount = 0;
    for (const entry of allEntries) {
      // Delete entries not updated in 24 hours
      if (now - entry.lastUpdated > maxAge) {
        await ctx.db.delete(entry._id);
        cleanedCount++;
      }
    }

    return cleanedCount;
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

// Initialize signup - create request and return verification code
export const initSignup = internalMutation({
  args: {},
  returns: v.object({
    verificationCode: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    requestId: v.id("agentSignupRequests"),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const verificationCode = generateVerificationCode();
    const codeHash = await hashCode(verificationCode);
    const expiresAt = now + CONFIG.CODE_EXPIRY_MS;

    const requestId = await ctx.db.insert("agentSignupRequests", {
      codeHash,
      status: "pending",
      createdAt: now,
      expiresAt,
      verifyAttempts: 0,
    });

    return {
      verificationCode,
      codeHash,
      expiresAt,
      requestId,
    };
  },
});

// Get signup request by code hash
export const getRequestByCodeHash = internalQuery({
  args: { codeHash: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("agentSignupRequests"),
      status: v.string(),
      expiresAt: v.number(),
      verifyAttempts: v.number(),
      agentId: v.optional(v.id("agents")), // NEW: Agent reference
      userId: v.optional(v.id("users")), // DEPRECATED: Kept for backward compat
      apiKeyId: v.optional(v.id("apiKeys")),
      keyPrefix: v.optional(v.string()),
      handle: v.optional(v.string()), // NEW: Agent's handle
      claimExpiresAt: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("agentSignupRequests")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", args.codeHash))
      .first();

    if (!request) return null;

    return {
      _id: request._id,
      status: request.status,
      expiresAt: request.expiresAt,
      verifyAttempts: request.verifyAttempts,
      agentId: request.agentId,
      userId: request.userId,
      apiKeyId: request.apiKeyId,
      keyPrefix: request.keyPrefix,
      handle: request.handle,
      claimExpiresAt: request.claimExpiresAt,
    };
  },
});

// Increment verify attempts
export const incrementVerifyAttempts = internalMutation({
  args: {
    requestId: v.id("agentSignupRequests"),
    failureReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;

    const newAttempts = request.verifyAttempts + 1;
    const updates: Record<string, unknown> = {
      verifyAttempts: newAttempts,
    };

    if (args.failureReason) {
      updates.failureReason = args.failureReason;
    }

    if (newAttempts >= CONFIG.MAX_VERIFY_ATTEMPTS) {
      updates.status = "failed";
    }

    await ctx.db.patch(args.requestId, updates);
    return null;
  },
});

// Create agent and API key (agent-centric model)
// Creates an entry in the agents table (not users table)
export const createAgentUserAndKey = internalMutation({
  args: {
    requestId: v.id("agentSignupRequests"),
    socialPostUrl: v.string(),
    platform: v.union(v.literal("x"), v.literal("moltbook")),
    claimEmail: v.optional(v.string()),
    verificationCode: v.string(),
    handle: v.string(), // NEW: Agent-chosen handle
  },
  returns: v.object({
    agentId: v.id("agents"), // NEW: Agent ID
    userId: v.id("users"), // DEPRECATED: Kept for backward compat (creates placeholder)
    apiKeyId: v.id("apiKeys"),
    apiKey: v.string(),
    keyPrefix: v.string(),
    linkToken: v.string(), // Renamed from claimToken
    linkExpiresAt: v.number(), // Renamed from claimExpiresAt
    // Deprecated aliases for backward compat
    claimToken: v.string(),
    claimExpiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Validate handle
    const handleError = validateHandle(args.handle);
    if (handleError) {
      throw new ConvexError({
        code: "INVALID_HANDLE",
        message: handleError,
      });
    }

    // Check handle uniqueness
    const existingHandle = await ctx.db
      .query("agents")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .first();

    if (existingHandle) {
      throw new ConvexError({
        code: "HANDLE_TAKEN",
        message: `Handle "${args.handle}" is already taken`,
      });
    }

    // Create agent (NEW: primary identity)
    const agentId = await ctx.db.insert("agents", {
      handle: args.handle,
      socialProof: {
        platform: args.platform,
        postUrl: args.socialPostUrl,
        verifiedAt: now,
      },
      // No linkedUserId - agent starts unlinked (fully autonomous)
      createdAt: now,
      updatedAt: now,
    });

    // Generate display name from handle for legacy compatibility
    const displayName = `Agent-${args.handle}`;

    // Create placeholder user for backward compatibility during migration
    // TODO: Remove this once migration is complete
    const userId = await ctx.db.insert("users", {
      isAgentCreated: true,
      displayName,
      agentSocialProof: {
        platform: args.platform,
        postUrl: args.socialPostUrl,
        verifiedAt: now,
      },
      claimEmail: args.claimEmail,
      createdAt: now,
      updatedAt: now,
    });

    // Generate API key
    const apiKey = generateApiKey();
    const keyHash = await hashCode(apiKey);
    const keyPrefix = apiKey.slice(0, 12);

    const apiKeyId = await ctx.db.insert("apiKeys", {
      agentId, // NEW: Link to agent
      userId, // DEPRECATED: Kept for backward compat
      name: `${args.handle}-key`,
      keyHash,
      keyPrefix,
      createdAt: now,
      isRevoked: false,
      allowAutoPost: false, // DEPRECATED: Use agent.oversightLevel
    });

    // Generate link token (renamed from claim token)
    const linkExpiresAt = now + CONFIG.LINK_EXPIRY_MS;
    const secret =
      process.env.EMAIL_ACTION_SECRET || "dev-secret-change-in-prod";
    const linkToken = await generateClaimToken(
      args.requestId.toString(),
      linkExpiresAt,
      secret
    );
    const linkTokenHash = await hashCode(linkToken);

    // Update request with results
    await ctx.db.patch(args.requestId, {
      status: "verified",
      verifiedAt: now,
      socialPostUrl: args.socialPostUrl,
      claimEmail: args.claimEmail,
      handle: args.handle, // NEW: Store handle
      agentId, // NEW: Agent reference
      userId, // DEPRECATED: Kept for backward compat
      apiKeyId,
      keyPrefix,
      claimTokenHash: linkTokenHash,
      claimExpiresAt: linkExpiresAt,
    });

    return {
      agentId,
      userId, // DEPRECATED
      apiKeyId,
      apiKey,
      keyPrefix,
      linkToken,
      linkExpiresAt,
      // Deprecated aliases
      claimToken: linkToken,
      claimExpiresAt: linkExpiresAt,
    };
  },
});

// Update claim email for an agent
export const updateClaimEmail = internalMutation({
  args: {
    userId: v.id("users"),
    claimEmail: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.isAgentCreated) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Agent user not found",
      });
    }

    await ctx.db.patch(args.userId, {
      claimEmail: args.claimEmail,
      updatedAt: Date.now(),
    });

    // Also update the signup request if it exists
    const request = await ctx.db
      .query("agentSignupRequests")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (request) {
      await ctx.db.patch(request._id, {
        claimEmail: args.claimEmail,
      });
    }

    return null;
  },
});

// Regenerate claim link for an agent
export const regenerateClaimLink = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    claimToken: v.string(),
    claimExpiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.isAgentCreated) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Agent user not found",
      });
    }

    if (user.absorbedInto) {
      throw new ConvexError({
        code: "ALREADY_CLAIMED",
        message: "This agent has already been claimed",
      });
    }

    // Find the signup request
    const request = await ctx.db
      .query("agentSignupRequests")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!request) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Signup request not found",
      });
    }

    // Generate new claim token
    const now = Date.now();
    const claimExpiresAt = now + CONFIG.CLAIM_EXPIRY_MS;
    const secret = process.env.EMAIL_ACTION_SECRET || "dev-secret-change-in-prod";
    const claimToken = await generateClaimToken(
      request._id.toString(),
      claimExpiresAt,
      secret
    );
    const claimTokenHash = await hashCode(claimToken);

    // Update request with new token
    await ctx.db.patch(request._id, {
      claimTokenHash,
      claimExpiresAt,
    });

    return {
      claimToken,
      claimExpiresAt,
    };
  },
});

// Get claim status for an agent
export const getClaimStatus = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(
    v.object({
      claimed: v.literal(false),
      claimLinkExpired: v.boolean(),
      claimExpiresAt: v.optional(v.number()),
    }),
    v.object({
      claimed: v.literal(true),
      claimedAt: v.number(),
      claimedByGithubUsername: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.isAgentCreated) {
      return null;
    }

    if (user.absorbedInto) {
      // Agent has been claimed
      const claimingUser = await ctx.db.get(user.absorbedInto);
      return {
        claimed: true as const,
        claimedAt: user.claimedAt!,
        claimedByGithubUsername: claimingUser?.githubUsername,
      };
    }

    // Find the signup request to get claim expiry
    const request = await ctx.db
      .query("agentSignupRequests")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const now = Date.now();
    const claimExpiresAt = request?.claimExpiresAt;
    const claimLinkExpired = claimExpiresAt ? now > claimExpiresAt : true;

    return {
      claimed: false as const,
      claimLinkExpired,
      claimExpiresAt,
    };
  },
});

// Get signup request by ID
export const getRequestById = internalQuery({
  args: { requestId: v.id("agentSignupRequests") },
  returns: v.union(
    v.object({
      _id: v.id("agentSignupRequests"),
      status: v.string(),
      userId: v.optional(v.id("users")),
      apiKeyId: v.optional(v.id("apiKeys")),
      claimExpiresAt: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;

    return {
      _id: request._id,
      status: request.status,
      userId: request.userId,
      apiKeyId: request.apiKeyId,
      claimExpiresAt: request.claimExpiresAt,
    };
  },
});

// Claim an agent - migrate API key, posts, comments, likes to human
export const claimAgent = internalMutation({
  args: {
    requestId: v.id("agentSignupRequests"),
    humanUserId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || !request.userId || !request.apiKeyId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Signup request not found",
      });
    }

    const agentUser = await ctx.db.get(request.userId);
    if (!agentUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Agent user not found",
      });
    }

    if (agentUser.absorbedInto) {
      throw new ConvexError({
        code: "ALREADY_CLAIMED",
        message: "This agent has already been claimed",
      });
    }

    // Use shared helper for migration
    await performClaimMigration(
      ctx,
      request.userId,
      args.humanUserId,
      request.apiKeyId
    );

    return null;
  },
});

// Expire old pending signup requests (called by cron)
export const expirePendingRequests = internalMutation({
  args: {},
  returns: v.number(), // Number of requests expired
  handler: async (ctx) => {
    const now = Date.now();

    // Find pending requests that have expired
    const expiredRequests = await ctx.db
      .query("agentSignupRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    // Mark them as expired
    for (const request of expiredRequests) {
      await ctx.db.patch(request._id, {
        status: "expired",
      });
    }

    return expiredRequests.length;
  },
});

// ============================================================================
// PUBLIC MUTATIONS (for frontend)
// ============================================================================

// Claim an agent from the frontend (requires authentication)
export const claimAgentPublic = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get the current user from auth
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        success: false,
        error: "not_authenticated",
      };
    }

    // Get the user from our database
    const user = await ctx.db.get(userId);

    if (!user) {
      return {
        success: false,
        error: "user_not_found",
      };
    }

    // Don't allow agent users to claim other agents
    if (user.isAgentCreated) {
      return {
        success: false,
        error: "agent_cannot_claim",
      };
    }

    // Verify the claim token
    const secret = process.env.EMAIL_ACTION_SECRET || "dev-secret-change-in-prod";
    const verified = await verifyClaimToken(args.token, secret);

    if (!verified || !verified.isValid) {
      return {
        success: false,
        error: "invalid_token",
      };
    }

    // Check expiry
    if (Date.now() > verified.expiry) {
      return {
        success: false,
        error: "expired",
      };
    }

    // Get the signup request
    const requestId = verified.signupRequestId as Id<"agentSignupRequests">;
    const request = await ctx.db.get(requestId);

    if (!request || !request.userId || !request.apiKeyId) {
      return {
        success: false,
        error: "invalid_token",
      };
    }

    // Check if already claimed
    const agentUser = await ctx.db.get(request.userId);
    if (!agentUser) {
      return {
        success: false,
        error: "invalid_token",
      };
    }

    if (agentUser.absorbedInto) {
      return {
        success: false,
        error: "already_claimed",
      };
    }

    // Use shared helper for migration
    await performClaimMigration(
      ctx,
      request.userId,
      user._id,
      request.apiKeyId
    );

    return {
      success: true,
    };
  },
});

// Export config for use in HTTP endpoints
export { CONFIG, getSuggestedPost, hashCode };
