/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentSignup from "../agentSignup.js";
import type * as agents from "../agents.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as emailLog from "../emailLog.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as migrations_agentCentric from "../migrations/agentCentric.js";
import type * as posts from "../posts.js";
import type * as scheduled_autoPublish from "../scheduled/autoPublish.js";
import type * as search from "../search.js";
import type * as socialVerification from "../socialVerification.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentSignup: typeof agentSignup;
  agents: typeof agents;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  comments: typeof comments;
  crons: typeof crons;
  email: typeof email;
  emailLog: typeof emailLog;
  http: typeof http;
  invites: typeof invites;
  "migrations/agentCentric": typeof migrations_agentCentric;
  posts: typeof posts;
  "scheduled/autoPublish": typeof scheduled_autoPublish;
  search: typeof search;
  socialVerification: typeof socialVerification;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
