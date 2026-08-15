/**
 * @file Interactive dialog for starting a new conversation from scratch.
 *
 * Prompts for an initial user message and optional conversation metadata,
 * generates a canonical ConversationLog, and dispatches analysis.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createConversationLog } from "@/lib/conversations/create";
import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId, ProviderStatus } from "@/lib/providers/types";

export type StartConversationDialogProps = {
  /** Discovered candidate analysis providers. */
  providers: ProviderStatus[];
  /** The currently selected provider ID. */
  provider: ProviderId;
  /** Callback when the selected provider changes. */
  onProviderChange: (provider: ProviderId) => void;
  /** Callback to dispatch ranking and workbench navigation. */
  onStart: (log: ConversationLog, provider: ProviderId) => Promise<void>;
  /** Optional custom trigger element. */
  trigger?: React.ReactNode;
};

/**
 * Dialog allowing users to initiate a new conversation directly in Resolve.
 *
 * @param props - Component properties for provider state and submission handler.
 */
export function StartConversationDialog({
  providers,
  provider,
  onProviderChange,
  onStart,
  trigger,
}: StartConversationDialogProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [customName, setCustomName] = useState("");
  const [userName, setUserName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedProvider = providers.find((item) => item.id === provider);
  const providerReady = Boolean(selectedProvider?.operational);

  /** Validates input, builds canonical log, and initiates ranking. */
  async function submit() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || submitting) return;

    let log: ConversationLog;
    try {
      log = createConversationLog({
        initialMessage: trimmedMessage,
        conversationId: customName.trim() || undefined,
        userId: userName.trim() || undefined,
        domain: domain.trim() || undefined,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The conversation could not be created.",
      );
      return;
    }

    setSubmitting(true);
    setOpen(false);
    setMessage("");
    setCustomName("");
    setUserName("");
    setDomain("");
    setError("");
    setSubmitting(false);
    try {
      await onStart(log, provider);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Starting conversation failed.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button size="sm" className="rounded-full">
              Start a conversation
            </Button>
          )
        }
      >
        {!trigger && "Start a conversation"}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Start a conversation</DialogTitle>
          <DialogDescription>
            Enter an initial message to analyze grounded interpretations and start a new decision track.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-4 pt-2"
        >
          {!providers.some((item) => item.operational) && (
            <Alert role="status" className="border-amber-200 bg-amber-50 text-amber-950">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
              <AlertTitle className="text-xs">No provider is ready</AlertTitle>
              <AlertDescription className="text-xs">
                Check the server configuration or Codex CLI, then reopen this dialog to retry discovery.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <label htmlFor="start-provider" className="mb-2 block text-xs font-semibold">
              Provider
            </label>
            <Select
              value={provider}
              onValueChange={(value) => onProviderChange(String(value) as ProviderId)}
            >
              <SelectTrigger
                id="start-provider"
                aria-label="Analysis provider"
                className="w-full rounded-xl"
              >
                <SelectValue>
                  {providers.find((item) => item.id === provider)?.name ??
                    "No operational provider"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {providers.map((item) => (
                  <SelectItem key={item.id} value={item.id} disabled={!item.operational}>
                    {item.name}
                    {item.operational ? "" : item.configured ? " — not ready" : " — unavailable"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="start-conversation-message" className="mb-2 block text-xs font-semibold">
              Initial message
            </label>
            <Textarea
              id="start-conversation-message"
              aria-label="Initial message"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setError("");
              }}
              placeholder="e.g. Prepare the sales breakdown by region for Q3."
              className="min-h-24 resize-y rounded-xl text-xs"
              autoFocus
            />
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
            <p className="text-xs font-semibold text-muted-foreground">Optional details</p>

            <div>
              <label htmlFor="start-conversation-name" className="mb-1 block text-xs">
                Conversation name (optional)
              </label>
              <Input
                id="start-conversation-name"
                aria-label="Conversation name (optional)"
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="e.g. Q3 Sales Report"
                className="rounded-xl text-xs"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="start-conversation-user" className="mb-1 block text-xs">
                  User name (optional)
                </label>
                <Input
                  id="start-conversation-user"
                  aria-label="User name (optional)"
                  value={userName}
                  onChange={(event) => setUserName(event.target.value)}
                  placeholder="e.g. Alex"
                  className="rounded-xl text-xs"
                />
              </div>

              <div>
                <label htmlFor="start-conversation-domain" className="mb-1 block text-xs">
                  Domain (optional)
                </label>
                <Input
                  id="start-conversation-domain"
                  aria-label="Domain (optional)"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="e.g. Finance"
                  className="rounded-xl text-xs"
                />
              </div>
            </div>
          </div>

          {error && (
            <Alert role="alert" className="border-rose-200 bg-rose-50 text-rose-950">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
              <AlertTitle className="text-xs">Check the conversation</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            className="w-full rounded-xl"
            disabled={submitting || !message.trim() || !providerReady}
          >
            {submitting ? "Starting…" : "Start conversation"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
