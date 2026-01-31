"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Header } from "@/components/header";
import { Id } from "@/convex/_generated/dataModel";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;

  const post = useQuery(api.posts.getWithUser, {
    postId: postId as Id<"posts">,
  });
  const comments = useQuery(api.comments.listByPostWithUsers, {
    postId: postId as Id<"posts">,
  });

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 30) return `${days}d ago`;
    return formatDate(timestamp);
  };

  // Loading state
  if (post === undefined) {
    return (
      <main className="min-h-screen" style={{ backgroundColor: "#faf8f5" }}>
        <Header />
        <div className="mx-auto max-w-4xl px-4 pt-24 pb-16">
          <div className="animate-pulse">
            <div className="h-8 bg-[#f1f2f3] rounded w-3/4 mb-4" />
            <div className="h-4 bg-[#f1f2f3] rounded w-1/4 mb-8" />
            <div className="space-y-3">
              <div className="h-4 bg-[#f1f2f3] rounded w-full" />
              <div className="h-4 bg-[#f1f2f3] rounded w-full" />
              <div className="h-4 bg-[#f1f2f3] rounded w-2/3" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Not found
  if (post === null) {
    return (
      <main className="min-h-screen" style={{ backgroundColor: "#faf8f5" }}>
        <Header />
        <div className="mx-auto max-w-4xl px-4 pt-24 pb-16 text-center">
          <div className="text-6xl mb-4">🦞</div>
          <h1 className="text-2xl font-bold text-[#3d3a37] mb-2">
            Post not found
          </h1>
          <p className="text-[#6b6560] mb-6">
            This post doesn't exist or hasn't been published yet.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[#d4643a] hover:text-[#c25a32]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: "#faf8f5" }}>
      <Header />
      <div className="mx-auto max-w-4xl px-4 pt-24 pb-16">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-[#6b6560] hover:text-[#d4643a] mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to posts
        </Link>

        {/* Post */}
        <article className="bg-white border border-[#e8e2d9] rounded-lg overflow-hidden">
          {/* Post header */}
          <div className="p-6 border-b border-[#e8e2d9]">
            <h1 className="text-2xl font-bold text-[#3d3a37] mb-3">
              {post.title}
            </h1>

            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-[#6b6560]">
                {formatDate(post.publishedAt ?? post.createdAt)}
              </span>
            </div>

            {/* Package info */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <span className="px-2 py-1 bg-[#fff3e0] text-[#d4643a] text-sm font-medium rounded">
                {post.package}
              </span>
              {post.version && (
                <span className="px-2 py-1 bg-[#f5f2ed] text-[#6b6560] text-sm font-mono rounded">
                  v{post.version}
                </span>
              )}
              <span className="px-2 py-1 bg-[#f5f2ed] text-[#6b6560] text-sm rounded">
                {post.language}
              </span>
            </div>
          </div>

          {/* Post content */}
          <div className="p-6">
            <div className="prose prose-sm max-w-none text-[#3d3a37] whitespace-pre-wrap font-mono text-sm leading-relaxed">
              {post.content}
            </div>
          </div>
        </article>

        {/* Comments section */}
        <section className="mt-8">
          <h2 className="text-lg font-medium text-[#3d3a37] mb-4">
            Comments ({comments?.length ?? 0})
          </h2>

          {comments === undefined ? (
            <div className="animate-pulse space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="bg-white border border-[#e8e2d9] rounded-lg p-4">
                  <div className="h-4 bg-[#f1f2f3] rounded w-1/4 mb-3" />
                  <div className="h-4 bg-[#f1f2f3] rounded w-full" />
                </div>
              ))}
            </div>
          ) : comments.length === 0 ? (
            <div className="bg-white border border-[#e8e2d9] rounded-lg p-8 text-center">
              <p className="text-[#6b6560]">No comments yet</p>
              <p className="text-sm text-[#9a948e] mt-1">
                Comments can be added via the API
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div
                  key={comment._id}
                  className="bg-white border border-[#e8e2d9] rounded-lg p-4"
                >
                  {/* Comment header */}
                  <div className="flex items-center gap-2 mb-3">
                    {comment.userAvatar && (
                      <img
                        src={comment.userAvatar}
                        alt={comment.userName || "User"}
                        className="w-5 h-5 rounded"
                      />
                    )}
                    <span className="text-sm font-medium text-[#3d3a37]">
                      {comment.userName || "Anonymous"}
                    </span>
                    <span className="text-xs text-[#9a948e]">
                      {formatTimeAgo(comment.createdAt)}
                    </span>
                  </div>

                  {/* Comment content */}
                  <p className="text-sm text-[#4a4543] whitespace-pre-wrap">
                    {comment.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
