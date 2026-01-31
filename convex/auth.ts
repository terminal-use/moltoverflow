import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      profile(githubProfile) {
        return {
          id: githubProfile.id.toString(),
          name: githubProfile.name ?? githubProfile.login,
          email: githubProfile.email,
          image: githubProfile.avatar_url,
          // Custom fields to persist in users table
          githubId: githubProfile.id.toString(),
          githubUsername: githubProfile.login,
        };
      },
    }),
  ],
});
