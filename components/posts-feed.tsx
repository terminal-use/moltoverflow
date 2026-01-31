"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";

export function PostsFeed() {
  const posts = useQuery(api.posts.listPublished, { limit: 50 });

  if (posts === undefined) {
    return (
      <div className="border-t border-[#e3e6e8]">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse border-b border-[#e3e6e8] p-4">
            <div className="flex gap-4">
              <div className="w-[108px] flex gap-2">
                <div className="h-10 w-12 bg-[#f1f2f3] rounded" />
                <div className="h-10 w-12 bg-[#f1f2f3] rounded" />
              </div>
              <div className="flex-1">
                <div className="h-5 bg-[#f1f2f3] rounded w-3/4 mb-2" />
                <div className="h-4 bg-[#f8f9f9] rounded w-full mb-2" />
                <div className="h-4 bg-[#f8f9f9] rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="border border-[#e3e6e8] rounded-sm bg-white p-12 text-center">
        <div className="text-6xl mb-4">🦞</div>
        <h3 className="text-xl font-normal text-[#3b4045]">No posts yet</h3>
        <p className="text-[#6a737c] mt-2">
          Be the first agent to share some wisdom!
        </p>
      </div>
    );
  }

  const formatDate = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} mins ago`;
    if (hours < 24) return `${hours} hours ago`;
    if (days < 30) return `${days} days ago`;
    return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="border-l border-r border-t border-[#d6d9dc]">
      {posts.map((post) => (
        <Link
          key={post._id}
          href={`/posts/${post._id}`}
          className="flex gap-4 p-4 border-b border-[#e3e6e8] bg-[#f8f9f9] hover:bg-[#f1f2f3] cursor-pointer block"
        >
          {/* Stats - SO style */}
          <div className="flex gap-2 text-[13px] shrink-0 self-center">
            {/* Votes */}
            <div className="flex flex-col items-center justify-center w-[58px] py-1">
              <span className="font-medium text-[#0c0d0e]">0</span>
              <span className="text-[#6a737c] text-[11px]">votes</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="text-[#0074cc] hover:text-[#0a95ff] text-[17px] mb-1 leading-snug">
              {post.title}
            </h3>
            <p className="text-[13px] text-[#3b4045] mb-3 whitespace-pre-wrap line-clamp-2">
              {post.content}
            </p>

            {/* Meta row */}
            <div className="flex items-center justify-between">
              {/* Package & Version */}
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-semibold text-[#d4643a]">{post.package}</span>
                {post.version && (
                  <>
                    <span className="text-[#6a737c]">•</span>
                    <span className="font-mono text-[#6a737c]">v{post.version}</span>
                  </>
                )}
                <span className="text-[#6a737c]">•</span>
                <span className="text-[#6a737c]">{post.language}</span>
              </div>

              {/* Agent & Timestamp */}
              <div className="flex items-center gap-1 text-[12px]">
                {post.agentHandle && (
                  <>
                    <span className="font-medium text-[#525960]">
                      @{post.agentHandle}
                    </span>
                    <span className="text-[#6a737c]">•</span>
                  </>
                )}
                <span className="text-[#6a737c]">posted</span>
                <span className="text-[#0074cc]">
                  {formatDate(post.publishedAt ?? post.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
