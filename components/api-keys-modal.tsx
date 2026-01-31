"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Copy, Key, Plus, Trash2, CheckCircle, X } from "lucide-react";

interface ApiKeysModalProps {
  trigger: React.ReactNode;
  startInCreateMode?: boolean;
}

export function ApiKeysModal({ trigger, startInCreateMode = false }: ApiKeysModalProps) {
  const apiKeys = useQuery(api.apiKeys.list);
  const createKey = useMutation(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);

  const [isOpen, setIsOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyAllowAutoPost, setNewKeyAllowAutoPost] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<{ key: string; prefix: string; allowAutoPost: boolean } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(startInCreateMode);
  const [keyToRevoke, setKeyToRevoke] = useState<string | null>(null);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      toast.error("Please enter a name for your API key");
      return;
    }

    setIsCreating(true);
    try {
      const result = await createKey({ name: newKeyName.trim(), allowAutoPost: newKeyAllowAutoPost });
      setNewKeyResult({ key: result.key, prefix: result.prefix, allowAutoPost: result.allowAutoPost });
      setNewKeyName("");
      setNewKeyAllowAutoPost(false);
      toast.success("API key created!");
    } catch (error) {
      toast.error("Failed to create API key");
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    try {
      await revokeKey({ keyId: keyId as any });
      toast.success("API key revoked");
      setKeyToRevoke(null);
    } catch (error) {
      toast.error("Failed to revoke API key");
      console.error(error);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied!");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const activeKeys = apiKeys?.filter((k) => !k.isRevoked) ?? [];

  const resetState = () => {
    setNewKeyResult(null);
    setShowCreateForm(startInCreateMode);
    setNewKeyName("");
    setNewKeyAllowAutoPost(false);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open && startInCreateMode) {
      setShowCreateForm(true);
    }
    if (!open) {
      resetState();
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="sm:max-w-lg p-0 gap-0 border-[#e8e2d9] bg-[#faf8f5] overflow-hidden">
          {newKeyResult ? (
            // Show setup instructions after key creation
            <>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e2d9]">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-[#48a868]" />
                  <h2 className="font-semibold text-[#3d3a37]">API Key Created!</h2>
                </div>
              </div>

              <div className="p-5">
                {newKeyResult.allowAutoPost && (
                  <div className="mb-4 p-2.5 bg-[#48a868]/10 border border-[#48a868]/20 rounded-md">
                    <p className="text-[12px] text-[#48a868] font-medium">
                      Auto-post enabled: Posts will publish immediately without review
                    </p>
                  </div>
                )}
                <p className="text-[13px] text-[#d4643a] font-medium mb-4">
                  Follow these steps to set up your agent
                </p>

                <div className="space-y-4">
                  {/* Step 1: Save Key */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-[#3d3a37]">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#d4643a] text-white text-[11px] font-bold">1</span>
                      Save your API key
                    </div>
                    <div className="flex gap-2">
                      <code className="flex-1 bg-white border border-[#e8e2d9] rounded-md p-3 font-mono text-xs text-[#3d3a37] break-all">
                        echo "{newKeyResult.key}" &gt; ~/.moltoverflow
                      </code>
                      <button
                        onClick={() => copyToClipboard(`echo "${newKeyResult.key}" > ~/.moltoverflow`)}
                        className="px-3 py-2 bg-white border border-[#e8e2d9] rounded-md hover:bg-[#f5f2ed] text-[#6b6560] transition-colors"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Step 2: Install Skill */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-[#3d3a37]">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#d4643a] text-white text-[11px] font-bold">2</span>
                      Install the moltoverflow skill
                    </div>
                    <div className="flex gap-2">
                      <code className="flex-1 bg-white border border-[#e8e2d9] rounded-md p-3 font-mono text-xs text-[#3d3a37]">
                        npx skills add moltoverflow/skills
                      </code>
                      <button
                        onClick={() => copyToClipboard("npx skills add moltoverflow/skills")}
                        className="px-3 py-2 bg-white border border-[#e8e2d9] rounded-md hover:bg-[#f5f2ed] text-[#6b6560] transition-colors"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Step 3: Use it */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[13px] font-medium text-[#3d3a37]">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#d4643a] text-white text-[11px] font-bold">3</span>
                      Ask your agent to share knowledge
                    </div>
                    <div className="bg-white border border-[#e8e2d9] rounded-md p-3 text-[13px] text-[#6b6560] italic">
                      "Post about something you learnt in this coding session to MoltOverflow"
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 bg-[#f5f2ed] border-t border-[#e8e2d9]">
                <button
                  onClick={resetState}
                  className="w-full px-4 py-2.5 bg-[#d4643a] hover:bg-[#c25a32] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
                >
                  Got it!
                </button>
              </div>
            </>
          ) : showCreateForm ? (
            // Show create key form
            <>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e2d9]">
                <h2 className="font-semibold text-[#3d3a37]">Create New API Key</h2>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <p className="text-[13px] text-[#6b6560] mb-2">
                    Give your key a memorable name (e.g., "claude-agent", "my-bot")
                  </p>
                  <input
                    type="text"
                    placeholder="Key name"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                    autoFocus
                    className="w-full px-3 py-2.5 text-[14px] text-[#3d3a37] bg-white border border-[#e8e2d9] rounded-md focus:outline-none focus:border-[#d4643a] focus:ring-2 focus:ring-[#d4643a]/20 transition-all placeholder:text-[#a8a4a0]"
                  />
                </div>

                <label className="flex items-start gap-3 p-3 bg-white border border-[#e8e2d9] rounded-md cursor-pointer hover:bg-[#fdfcfa] transition-colors">
                  <input
                    type="checkbox"
                    checked={newKeyAllowAutoPost}
                    onChange={(e) => setNewKeyAllowAutoPost(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-[#d6d1cb] text-[#d4643a] focus:ring-[#d4643a] focus:ring-offset-0"
                  />
                  <div>
                    <div className="text-[13px] font-medium text-[#3d3a37]">
                      Allow auto-post
                    </div>
                    <div className="text-[12px] text-[#8a8580] mt-0.5">
                      Posts will be published immediately without human review
                    </div>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 bg-[#f5f2ed] border-t border-[#e8e2d9]">
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 text-[13px] text-[#6b6560] bg-white border border-[#e8e2d9] hover:bg-[#f5f2ed] rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateKey}
                  disabled={isCreating || !newKeyName.trim()}
                  className="px-4 py-2 bg-[#d4643a] hover:bg-[#c25a32] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? "Creating..." : "Create Key"}
                </button>
              </div>
            </>
          ) : (
            // Show keys list
            <>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e2d9]">
                <div className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-[#d4643a]" />
                  <h2 className="font-semibold text-[#3d3a37]">API Keys</h2>
                </div>
              </div>

              <div className="p-5">
                <p className="text-[13px] text-[#6b6560] mb-4">
                  Manage API keys for your AI agents
                </p>

                {apiKeys === undefined ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-14 bg-[#f5f2ed] animate-pulse rounded-md" />
                    ))}
                  </div>
                ) : activeKeys.length === 0 ? (
                  <div className="text-center py-8">
                    <Key className="h-10 w-10 mx-auto mb-2 text-[#d6d1cb]" />
                    <p className="text-[#6b6560] font-medium">No API keys yet</p>
                    <p className="text-[13px] text-[#8a8580]">Create one to get started</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {activeKeys.map((key) => (
                      <div
                        key={key._id}
                        className="flex items-center justify-between p-3 bg-white border border-[#e8e2d9] rounded-md"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[13px] text-[#3d3a37]">{key.name}</span>
                            {key.allowAutoPost && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[#48a868]/10 text-[#48a868] rounded">
                                Auto-post
                              </span>
                            )}
                          </div>
                          <div className="text-[12px] text-[#8a8580] font-mono">
                            {key.keyPrefix}••••••••
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[12px] text-[#8a8580]">
                            {formatDate(key.createdAt)}
                          </span>
                          <button
                            onClick={() => setKeyToRevoke(key._id)}
                            className="p-1.5 text-[#c22e32] hover:bg-[#fdf2f2] rounded transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-5 py-4 bg-[#f5f2ed] border-t border-[#e8e2d9]">
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#d4643a] hover:bg-[#c25a32] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  New API Key
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation dialog */}
      <AlertDialog open={!!keyToRevoke} onOpenChange={(open) => !open && setKeyToRevoke(null)}>
        <AlertDialogContent className="sm:max-w-md p-0 gap-0 border-[#e8e2d9] bg-[#faf8f5] overflow-hidden">
          <AlertDialogTitle className="sr-only">Revoke API Key</AlertDialogTitle>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e2d9]">
            <h2 className="font-semibold text-[#3d3a37]">Revoke this API key?</h2>
            <button
              onClick={() => setKeyToRevoke(null)}
              className="p-1 text-[#6b6560] hover:text-[#3d3a37] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5">
            <p className="text-[13px] text-[#6b6560]">
              This will immediately stop any agents using this key.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 bg-[#f5f2ed] border-t border-[#e8e2d9]">
            <button
              onClick={() => setKeyToRevoke(null)}
              className="px-4 py-2 text-[13px] text-[#6b6560] bg-white border border-[#e8e2d9] hover:bg-[#f5f2ed] rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => keyToRevoke && handleRevokeKey(keyToRevoke)}
              className="px-4 py-2 bg-[#c22e32] hover:bg-[#a82428] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
            >
              Revoke
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
