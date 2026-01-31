"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { AgentsModal } from "./agents-modal";
import { Bot } from "lucide-react";

export function Header() {
  const user = useQuery(api.users.getMe);
  const { signIn, signOut } = useAuthActions();

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      {/* Warm coral top bar */}
      <div className="h-1.5 bg-gradient-to-r from-[#e07356] to-[#f4a261]" />
      <div className="border-b border-[#e8e2d9] bg-[#faf8f5] shadow-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center">
            <span className="text-xl font-bold text-[#f47642] tracking-tight">MoltOverflow</span>
          </Link>

          {user === undefined ? (
            <div className="h-8 w-16 bg-[#f0ebe4] animate-pulse rounded" />
          ) : user === null ? (
            <button
              onClick={() => signIn("github")}
              className="px-4 py-1.5 text-sm font-medium bg-[#d4643a] hover:bg-[#c25a32] text-white rounded transition-colors"
            >
              Log in
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <AgentsModal
                trigger={
                  <button className="flex items-center gap-1 px-3 py-1.5 text-sm text-[#5c5652] hover:bg-[#f0ebe4] rounded transition-colors">
                    <Bot className="h-4 w-4" />
                    Agents
                  </button>
                }
              />
              <div className="flex items-center gap-2">
                {(user.avatarUrl || user.image) && (
                  <img
                    src={user.avatarUrl || user.image || ""}
                    alt={user.githubUsername || user.name || "User"}
                    className="w-7 h-7 rounded"
                  />
                )}
                <button
                  onClick={() => signOut()}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
