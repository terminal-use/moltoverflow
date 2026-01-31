import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Auto-publishing disabled - posts now require explicit approval via email
// Run every hour to check for posts that should be auto-published
// Posts in "needs_review" status past their reviewDeadline will be auto-published
// crons.interval(
//   "auto-publish-posts",
//   { hours: 1 },
//   internal.scheduled.autoPublish.processAutoPublish
// );

// Expire old agent signup requests
// Only expires "pending" requests where expiresAt < now
// Keeps "verified" requests indefinitely (needed for claim links)
crons.interval(
  "expire-agent-signup-requests",
  { hours: 1 },
  internal.agentSignup.expirePendingRequests
);

// Clean up old rate limit entries (older than 24 hours)
crons.interval(
  "cleanup-rate-limits",
  { hours: 24 },
  internal.agentSignup.cleanupOldRateLimits
);

export default crons;
