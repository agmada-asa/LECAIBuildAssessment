/** @file Imported conversation transcript and follow-up controls. */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Refresh01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { ConversationMessage } from "@/lib/ranking/types";

export type ConversationPanelProps = {
  messages: ConversationMessage[];
  userName: string;
  userRole: string;
  isProcessing: boolean;
  customMessage: string;
  onCustomMessageChange: (value: string) => void;
  onAddCustomMessage: () => void;
  onReset: () => void;
};

/** Formats imported timestamps without presenting parser placeholders as real dates. */
function messageTime(timestamp: string, index: number): string {
  return timestamp.startsWith("2000-01-01T00:")
    ? `Message ${index + 1} · time unavailable`
    : timestamp;
}

/** Shows the exact conversational evidence processed so far. */
export function ConversationPanel({
  messages,
  userName,
  userRole,
  isProcessing,
  customMessage,
  onCustomMessageChange,
  onAddCustomMessage,
  onReset,
}: ConversationPanelProps) {
  return (
    <section className="order-3 flex min-h-[480px] max-h-[70vh] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm xl:order-1 xl:h-[calc(100vh-104px)] xl:max-h-none">
      <div className="border-b px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-base font-semibold">Conversation</h2>
          <Badge variant="secondary" className="rounded-full px-2.5 font-mono text-xs">
            {messages.length} messages
          </Badge>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl border bg-muted/35 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <HugeiconsIcon icon={UserIcon} className="size-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">{userRole}</p>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-5">
          {messages.map((message, index) => (
            <div
              key={message.id}
              className="animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  {message.id}
                </span>
                <span className="text-xs text-muted-foreground/70">{messageTime(message.timestamp, index)}</span>
                {index === messages.length - 1 && (
                  <Badge className="ml-auto h-5 rounded-full bg-primary/10 px-2 text-xs text-primary shadow-none">
                    Latest
                  </Badge>
                )}
              </div>
              <div className="rounded-2xl rounded-tl-sm border bg-background px-4 py-3.5 text-[13px] leading-5 shadow-xs">
                {message.text}
              </div>
            </div>
          ))}

          {isProcessing && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground"
            >
              <span className="flex gap-1">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="size-1.5 animate-pulse rounded-full bg-primary"
                    style={{ animationDelay: `${dot * 120}ms` }}
                  />
                ))}
              </span>
              Updating evidence and scores…
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="space-y-3 border-t bg-muted/20 p-4">
        <div className="relative">
          <Textarea
            aria-label="Add a follow-up message"
            value={customMessage}
            onChange={(event) => onCustomMessageChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing ||
                isProcessing ||
                !customMessage.trim()
              ) {
                return;
              }

              // Plain Enter sends; Shift+Enter remains available for multiline messages.
              event.preventDefault();
              onAddCustomMessage();
            }}
            disabled={isProcessing}
            placeholder="Add a follow-up to test the ranking…"
            className="min-h-20 resize-none rounded-xl bg-background pr-12 text-xs"
          />
          <Button
            aria-label="Add follow-up message"
            size="icon"
            className="absolute right-2 bottom-2 size-8 rounded-lg"
            onClick={onAddCustomMessage}
            disabled={isProcessing || !customMessage.trim()}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" strokeWidth={2} />
          </Button>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <HugeiconsIcon icon={Refresh01Icon} className="size-3.5" strokeWidth={2} />
          Reset conversation
        </button>
      </div>
    </section>
  );
}
