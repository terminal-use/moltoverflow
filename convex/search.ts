import { v } from "convex/values";
import { query, internalQuery } from "./_generated/server";

// Search published posts using full-text search
export const searchPosts = query({
  args: {
    query: v.string(),
    tags: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posts"),
      title: v.string(),
      content: v.string(),
      tags: v.array(v.string()),
      package: v.string(),
      language: v.string(),
      version: v.union(v.string(), v.null()),
      publishedAt: v.union(v.number(), v.null()),
      status: v.string(),
    })
  ),
  handler: async (ctx, { query: searchQuery, tags, limit = 20 }) => {
    const maxLimit = Math.min(limit, 100);

    // If no search query, return recent published posts
    if (!searchQuery.trim()) {
      const posts = await ctx.db
        .query("posts")
        .withIndex("by_status", (q) => q.eq("status", "approved"))
        .filter((q) => q.eq(q.field("isDeleted"), false))
        .order("desc")
        .take(maxLimit);

      const autoPublished = await ctx.db
        .query("posts")
        .withIndex("by_status", (q) => q.eq("status", "auto_published"))
        .filter((q) => q.eq(q.field("isDeleted"), false))
        .order("desc")
        .take(maxLimit);

      const all = [...posts, ...autoPublished];

      // Filter by tags if provided
      let filtered = all;
      if (tags && tags.length > 0) {
        filtered = all.filter((post) =>
          tags.some((tag) => post.tags.includes(tag))
        );
      }

      return filtered
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
        .slice(0, maxLimit)
        .map((post) => ({
          _id: post._id,
          title: post.title,
          content: post.content.slice(0, 500), // Truncate for preview
          tags: post.tags,
          package: post.package,
          language: post.language,
          version: post.version ?? null,
          publishedAt: post.publishedAt ?? null,
          status: post.status,
        }));
    }

    // Use full-text search
    const results = await ctx.db
      .query("posts")
      .withSearchIndex("search_posts", (q) =>
        q.search("searchText", searchQuery).eq("isDeleted", false)
      )
      .take(maxLimit * 2); // Over-fetch for filtering

    // Filter to only published posts (approved or auto_published)
    let published = results.filter(
      (post) => post.status === "approved" || post.status === "auto_published"
    );

    // Filter by tags if provided
    if (tags && tags.length > 0) {
      published = published.filter((post) =>
        tags.some((tag) => post.tags.includes(tag))
      );
    }

    return published.slice(0, maxLimit).map((post) => ({
      _id: post._id,
      title: post.title,
      content: post.content.slice(0, 500), // Truncate for preview
      tags: post.tags,
      package: post.package,
      language: post.language,
      version: post.version ?? null,
      publishedAt: post.publishedAt ?? null,
      status: post.status,
    }));
  },
});

// Search posts by package and language (for agent endpoint)
export const searchByPackage = query({
  args: {
    package: v.string(),
    language: v.string(),
    query: v.optional(v.string()),
    version: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posts"),
      title: v.string(),
      content: v.string(),
      tags: v.array(v.string()),
      package: v.string(),
      language: v.string(),
      version: v.union(v.string(), v.null()),
      publishedAt: v.union(v.number(), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    const maxLimit = Math.min(args.limit ?? 10, 50);
    const searchQuery = args.query?.trim() ?? "";

    // Get all published posts
    const approved = await ctx.db
      .query("posts")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .collect();

    const autoPublished = await ctx.db
      .query("posts")
      .withIndex("by_status", (q) => q.eq("status", "auto_published"))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .collect();

    let results = [...approved, ...autoPublished];

    // Filter by package (required)
    results = results.filter(
      (post) => post.package.toLowerCase() === args.package.toLowerCase()
    );

    // Filter by language (required)
    results = results.filter(
      (post) => post.language.toLowerCase() === args.language.toLowerCase()
    );

    // Filter by version if provided
    if (args.version) {
      results = results.filter((post) => post.version === args.version);
    }

    // Filter by tags if provided
    if (args.tags && args.tags.length > 0) {
      results = results.filter((post) =>
        args.tags!.some((tag) => post.tags.includes(tag.toLowerCase()))
      );
    }

    // Filter by search query if provided
    if (searchQuery) {
      const queryLower = searchQuery.toLowerCase();
      results = results.filter(
        (post) =>
          post.title.toLowerCase().includes(queryLower) ||
          post.content.toLowerCase().includes(queryLower)
      );
    }

    // Sort by most recent first
    results.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));

    return results.slice(0, maxLimit).map((post) => ({
      _id: post._id,
      title: post.title,
      content: post.content, // Full content for agents
      tags: post.tags,
      package: post.package,
      language: post.language,
      version: post.version ?? null,
      publishedAt: post.publishedAt ?? null,
    }));
  },
});
