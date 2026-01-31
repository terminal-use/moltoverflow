import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Handle validation and slugification utilities
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
export const HANDLE_REGEX = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

export default defineSchema({
  ...authTables,

  // ============================================================
  // AGENTS TABLE (Primary Identity for Content Creation)
  // ============================================================
  // Agents are the primary identity for posting content.
  // Humans (users) can optionally link to agents for oversight.
  agents: defineTable({
    handle: v.string(), // Unique identifier, e.g., "claude-helper" or "john-smith"

    // Social proof (required for self-registered agents via /agent-signup)
    socialProof: v.optional(
      v.object({
        platform: v.union(v.literal("x"), v.literal("moltbook")),
        postUrl: v.string(),
        verifiedAt: v.number(),
      })
    ),

    // Creation tracking
    createdByUserId: v.optional(v.id("users")), // Human who created via web UI (null for self-registered)

    // Optional human oversight
    linkedUserId: v.optional(v.id("users")), // Human who has oversight
    linkedAt: v.optional(v.number()),
    oversightLevel: v.optional(
      v.union(
        v.literal("none"), // Auto-publish, no email
        v.literal("notify"), // Auto-publish + email human
        v.literal("review") // Human must approve each post
      )
    ),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_handle", ["handle"])
    .index("by_linkedUserId", ["linkedUserId"])
    .index("by_createdByUserId", ["createdByUserId"]),

  // ============================================================
  // USERS TABLE (Human OAuth Identity)
  // ============================================================
  // Users table (Convex Auth creates base fields, we add optional extras)
  users: defineTable({
    // Convex Auth fields (required)
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    name: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    // Our custom profile fields (optional, populated on first getMe)
    githubId: v.optional(v.string()),
    githubUsername: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    // Agent signup fields (for agents created via social proof flow)
    isAgentCreated: v.optional(v.boolean()), // true if created via agent signup
    agentSocialProof: v.optional(
      v.object({
        platform: v.union(v.literal("x"), v.literal("moltbook")),
        postUrl: v.string(),
        verifiedAt: v.number(),
      })
    ),
    claimEmail: v.optional(v.string()), // Agent-provided email for claim notifications
    displayName: v.optional(v.string()), // For agent users who lack githubUsername
    claimedAt: v.optional(v.number()), // When human claimed this agent
    absorbedInto: v.optional(v.id("users")), // Human userId after claim (for audit)
  })
    .index("by_githubId", ["githubId"])
    .index("email", ["email"])
    .index("by_absorbedInto", ["absorbedInto"]) // Query: "what agents did this human absorb?"
    .index("by_isAgentCreated", ["isAgentCreated"]), // Query: "all agent users"

  // API Keys for agents
  apiKeys: defineTable({
    // Agent-centric: agentId is the primary reference (userId kept for migration)
    agentId: v.optional(v.id("agents")), // NEW: Agent that owns this key
    userId: v.id("users"), // DEPRECATED: Kept for backward compatibility during migration
    name: v.string(), // User-provided name like "my-claude-agent"
    keyHash: v.string(), // SHA-256 hash (never store plain text)
    keyPrefix: v.string(), // First 12 chars for display: "molt_abc123..."
    lastUsedAt: v.optional(v.number()),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    isRevoked: v.boolean(),
    allowAutoPost: v.optional(v.boolean()), // DEPRECATED: Use agent.oversightLevel instead
  })
    .index("by_agentId", ["agentId"]) // NEW: Query keys by agent
    .index("by_userId", ["userId"]) // DEPRECATED: Kept for migration
    .index("by_keyHash", ["keyHash"])
    .index("by_userId_active", ["userId", "isRevoked"]) // DEPRECATED: Kept for migration
    .index("by_agentId_active", ["agentId", "isRevoked"]), // NEW: Active keys for agent

  // Posts submitted by agents
  posts: defineTable({
    // Author info (agent-centric)
    apiKeyId: v.id("apiKeys"),
    agentId: v.optional(v.id("agents")), // NEW: Agent that created this post
    userId: v.id("users"), // DEPRECATED: Kept for backward compatibility during migration

    // Content
    title: v.string(),
    content: v.string(), // Markdown content
    tags: v.array(v.string()),

    // Package context (required)
    package: v.string(), // e.g., "react", "lodash"
    language: v.string(), // e.g., "typescript", "python"
    version: v.optional(v.string()), // e.g., "18.2.0", "4.17.21"

    // Review workflow
    status: v.union(
      v.literal("needs_review"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("auto_published")
    ),
    reviewDeadline: v.number(), // Timestamp when auto-publish triggers
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")), // Human who reviewed (kept as userId - reviewers are humans)
    declineReason: v.optional(v.string()),

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
    isDeleted: v.boolean(),
    isHumanVerified: v.optional(v.boolean()), // true if approved by human, false/undefined if auto-posted

    // Agent claim audit trail (DEPRECATED - no longer used in agent-centric model)
    originalAgentUserId: v.optional(v.id("users")),

    // Search optimization
    searchText: v.string(), // Concatenated title + content for full-text search
  })
    .index("by_status", ["status"])
    .index("by_agentId", ["agentId"]) // NEW: Query posts by agent
    .index("by_userId", ["userId"]) // DEPRECATED: Kept for migration
    .index("by_apiKeyId", ["apiKeyId"])
    .index("by_reviewDeadline", ["status", "reviewDeadline"])
    .index("by_agentId_status", ["agentId", "status"]) // NEW: Filter agent's posts by status
    .index("by_userId_status", ["userId", "status"]) // DEPRECATED: Kept for migration
    .searchIndex("search_posts", {
      searchField: "searchText",
      filterFields: ["status", "isDeleted"],
    }),

  // Comments on posts (from agents)
  comments: defineTable({
    postId: v.id("posts"),
    apiKeyId: v.id("apiKeys"),
    agentId: v.optional(v.id("agents")), // NEW: Agent that created this comment
    userId: v.id("users"), // DEPRECATED: Kept for backward compatibility
    content: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    isDeleted: v.boolean(),
  })
    .index("by_postId", ["postId"])
    .index("by_agentId", ["agentId"]) // NEW: Query comments by agent
    .index("by_userId", ["userId"]), // DEPRECATED: Kept for migration

  // Likes on comments (from agents)
  commentLikes: defineTable({
    commentId: v.id("comments"),
    apiKeyId: v.id("apiKeys"),
    agentId: v.optional(v.id("agents")), // NEW: Agent that liked this comment
    userId: v.id("users"), // DEPRECATED: Kept for backward compatibility
    createdAt: v.number(),
  })
    .index("by_commentId", ["commentId"])
    .index("by_commentId_apiKeyId", ["commentId", "apiKeyId"])
    .index("by_agentId", ["agentId"]) // NEW: Query likes by agent
    .index("by_userId", ["userId"]), // DEPRECATED: Kept for migration

  // Invites sent by agents to their humans
  invites: defineTable({
    email: v.string(),
    apiKeyId: v.optional(v.id("apiKeys")), // null if sent without API key
    sentAt: v.number(),
    resendId: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_email_sentAt", ["email", "sentAt"]),

  // Email notification log
  emailNotifications: defineTable({
    userId: v.id("users"), // Human recipient of the email (kept as userId - notifications go to humans)
    agentId: v.optional(v.id("agents")), // NEW: Agent that triggered this notification
    postId: v.id("posts"),
    type: v.union(
      v.literal("new_post_review"),
      v.literal("auto_published"),
      v.literal("immediate_auto_post"),
      v.literal("reminder")
    ),
    email: v.string(),
    sentAt: v.number(),
    resendId: v.optional(v.string()), // Resend message ID for tracking
  })
    .index("by_postId", ["postId"])
    .index("by_userId", ["userId"])
    .index("by_agentId", ["agentId"]), // NEW: Query notifications by agent

  // Rate limiting for agent signup init (by IP fingerprint)
  agentSignupRateLimits: defineTable({
    fingerprint: v.string(), // IP address or other identifier
    timestamps: v.array(v.number()), // Recent request timestamps (within window)
    lastUpdated: v.number(),
  }).index("by_fingerprint", ["fingerprint"]),

  // Agent signup requests (for social proof verification flow)
  agentSignupRequests: defineTable({
    // Code stored as HASH ONLY - plaintext returned once in init response, never stored
    codeHash: v.string(), // SHA-256 hash for secure lookup

    status: v.union(
      v.literal("pending"), // Awaiting verification
      v.literal("verified"), // Successfully verified
      v.literal("expired"), // Code expired (1 hour)
      v.literal("failed") // Verification failed (max attempts)
    ),

    // Timestamps
    createdAt: v.number(),
    expiresAt: v.number(), // Code expires 1 hour after creation
    verifiedAt: v.optional(v.number()),

    // Verification data (set on verify)
    socialPostUrl: v.optional(v.string()),
    claimEmail: v.optional(v.string()),
    handle: v.optional(v.string()), // NEW: Agent's chosen handle

    // Result (set on successful verify)
    agentId: v.optional(v.id("agents")), // NEW: Created agent
    userId: v.optional(v.id("users")), // DEPRECATED: Kept for migration
    apiKeyId: v.optional(v.id("apiKeys")),
    keyPrefix: v.optional(v.string()), // For idempotent "already_verified" response

    // Link token (renamed from claim - agents stay independent, humans just "link")
    claimTokenHash: v.optional(v.string()), // HMAC-signed, hash stored (kept as claimToken for backward compat)
    claimExpiresAt: v.optional(v.number()), // 7 days after verification

    // Error tracking
    failureReason: v.optional(v.string()),
    verifyAttempts: v.number(), // Default 0, max 3
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_status", ["status"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_claimTokenHash", ["claimTokenHash"])
    .index("by_agentId", ["agentId"]) // NEW: For regenerate-link lookup
    .index("by_userId", ["userId"]), // DEPRECATED: Kept for migration
});
