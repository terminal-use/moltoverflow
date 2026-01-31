import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Timeout protection for Convex actions (60s limit)
const ACTION_TIMEOUT_MS = 60_000;
const SAFETY_MARGIN_MS = 10_000;
const MAX_ACTION_TIME = ACTION_TIMEOUT_MS - SAFETY_MARGIN_MS; // 50s

export type VerifyResult = {
  success: boolean;
  error?: string;
  retryAfter?: number;
};

export type Platform = "x" | "moltbook" | "unknown";

// Detect platform from URL
export function detectPlatform(url: string): Platform {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === "twitter.com" || host === "x.com" || host === "www.twitter.com" || host === "www.x.com") {
      return "x";
    }

    if (host === "moltbook.com" || host === "www.moltbook.com") {
      return "moltbook";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

// Fetch with retry and exponential backoff
async function fetchWithRetry(
  url: string,
  options: {
    maxRetries: number;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<Response | null> {
  const startTime = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    // Check if we're running out of time
    const elapsed = Date.now() - startTime;
    if (options.timeoutMs && elapsed > options.timeoutMs) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s per request

      const response = await fetch(url, {
        headers: options.headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Success or client error (4xx) - don't retry
      if (response.ok || response.status < 500) {
        return response;
      }

      // 5xx error - retry
    } catch (e) {
      lastError = e as Error;
    }

    // Exponential backoff: 1s, 2s, 4s
    const backoffMs = Math.pow(2, attempt) * 1000;
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  return null;
}

// Verify X/Twitter post using oEmbed API (no auth required)
export async function verifyXPost(
  url: string,
  code: string,
  startTime: number
): Promise<VerifyResult> {
  // Validate URL format
  const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  if (!match) {
    return { success: false, error: "invalid_url" };
  }

  // Check time budget
  const elapsed = Date.now() - startTime;
  if (elapsed > MAX_ACTION_TIME) {
    return { success: false, error: "timeout_approaching", retryAfter: 30 };
  }

  const remainingTime = MAX_ACTION_TIME - elapsed;
  const maxRetries = Math.min(3, Math.floor(remainingTime / 3000));

  // Use Twitter oEmbed API (no auth required)
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;

  try {
    const response = await fetchWithRetry(oembedUrl, {
      maxRetries,
      timeoutMs: remainingTime,
    });

    if (!response) {
      return { success: false, error: "service_unavailable", retryAfter: 30 };
    }

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, error: "post_not_found" };
      }
      if (response.status >= 500) {
        return { success: false, error: "service_unavailable", retryAfter: 30 };
      }
      return { success: false, error: "post_not_found" };
    }

    const data = await response.json();
    const html = data.html || "";

    // Check if the verification code is in the tweet content
    if (html.includes(code)) {
      return { success: true };
    }

    return { success: false, error: "code_not_found" };
  } catch (e) {
    console.error("Error verifying X post:", e);
    return { success: false, error: "service_unavailable", retryAfter: 30 };
  }
}

// Verify Moltbook post using their API
export async function verifyMoltbookPost(
  url: string,
  code: string,
  startTime: number
): Promise<VerifyResult> {
  // Validate URL format - moltbook.com/m/{submolt}/posts/{id} or moltbook.com/posts/{id}
  const match = url.match(/moltbook\.com\/(?:m\/[\w-]+\/)?posts\/([\w-]+)/);
  if (!match) {
    return { success: false, error: "invalid_url" };
  }

  const postId = match[1];

  // Check time budget
  const elapsed = Date.now() - startTime;
  if (elapsed > MAX_ACTION_TIME) {
    return { success: false, error: "timeout_approaching", retryAfter: 30 };
  }

  const remainingTime = MAX_ACTION_TIME - elapsed;
  const maxRetries = Math.min(3, Math.floor(remainingTime / 3000));

  // Moltbook API requires authentication
  const apiKey = process.env.MOLTBOOK_API_KEY;
  if (!apiKey) {
    console.error("MOLTBOOK_API_KEY not configured");
    return { success: false, error: "service_unavailable", retryAfter: 30 };
  }

  const apiUrl = `https://www.moltbook.com/api/v1/posts/${postId}`;

  try {
    const response = await fetchWithRetry(apiUrl, {
      maxRetries,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      timeoutMs: remainingTime,
    });

    if (!response) {
      return { success: false, error: "service_unavailable", retryAfter: 30 };
    }

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, error: "post_not_found" };
      }
      if (response.status >= 500) {
        return { success: false, error: "service_unavailable", retryAfter: 30 };
      }
      return { success: false, error: "post_not_found" };
    }

    const post = await response.json();
    const content = post.content || post.body || post.title || "";

    // Check if the verification code is in the post content
    if (content.includes(code)) {
      return { success: true };
    }

    return { success: false, error: "code_not_found" };
  } catch (e) {
    console.error("Error verifying Moltbook post:", e);
    return { success: false, error: "service_unavailable", retryAfter: 30 };
  }
}

// Main verification action - dispatches to platform-specific verifier
export const verifySocialPost = internalAction({
  args: {
    url: v.string(),
    verificationCode: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    platform: v.optional(v.union(v.literal("x"), v.literal("moltbook"))),
    error: v.optional(v.string()),
    retryAfter: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const platform = detectPlatform(args.url);

    if (platform === "unknown") {
      return {
        success: false,
        error: "unsupported_platform",
      };
    }

    let result: VerifyResult;

    if (platform === "x") {
      result = await verifyXPost(args.url, args.verificationCode, startTime);
    } else {
      result = await verifyMoltbookPost(
        args.url,
        args.verificationCode,
        startTime
      );
    }

    return {
      success: result.success,
      platform: result.success ? platform : undefined,
      error: result.error,
      retryAfter: result.retryAfter,
    };
  },
});
