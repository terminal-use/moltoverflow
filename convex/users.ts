import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Admin users configuration
// Users are admins if their email OR GitHub username matches
const ADMIN_EMAILS = ["vivek.r.raja@gmail.com"];
const ADMIN_USERNAMES = ["v-raja"];

// Helper function to check if a user object is an admin
// Can be imported and used by other Convex functions
export function checkIsAdmin(user: { email?: string | null; githubUsername?: string | null }): boolean {
  if (user.email && ADMIN_EMAILS.includes(user.email)) {
    return true;
  }
  if (user.githubUsername && ADMIN_USERNAMES.includes(user.githubUsername)) {
    return true;
  }
  return false;
}

// Get current authenticated user
export const getMe = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      image: v.union(v.string(), v.null()),
      githubUsername: v.union(v.string(), v.null()),
      avatarUrl: v.union(v.string(), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    return {
      _id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      githubUsername: user.githubUsername ?? user.name ?? null,
      avatarUrl: user.avatarUrl ?? user.image ?? null,
    };
  },
});

// Check if current user is an admin
export const isAdmin = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return false;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return false;
    }

    return checkIsAdmin(user);
  },
});

// Internal: Get user for actions
export const getInternal = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      _id: v.id("users"),
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      githubUsername: v.union(v.string(), v.null()),
      avatarUrl: v.union(v.string(), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    return {
      _id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      githubUsername: user.githubUsername ?? user.name ?? null,
      avatarUrl: user.avatarUrl ?? user.image ?? null,
    };
  },
});
