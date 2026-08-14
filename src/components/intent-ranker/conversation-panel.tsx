/** @file Conversation transcript, fixture progression, and follow-up controls. */

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  PlayIcon,
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
  totalFixtureMessages: number;
  userName: string;
  userRole: string;
  isProcessing: boolean;
  customMessage: string;
  onCustomMessageChange: (value: string) => void;
  onAddCustomMessage: () => void;
  onProcessNext: () => void;
  onReset: () => void;
};

/** Shows the exact conversational evidence processed so far. */
export function ConversationPanel({
  messages,
  totalFixtureMessages,
  userName,
  userRole,
  isProcessing,
  customMessage,
  onCustomMessageChange,
  onAddCustomMessage,
  onProcessNext,
  onReset,
}: ConversationPanelProps) {
  const fixtureMessagesRead = Math.min(messages.length, totalFixtureMessages);
  const canProcessFixture = fixtureMessagesRead < totalFixtureMessages;

  return (
    <section className="flex min-h-[580px] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm xl:h-[calc(100vh-104px)]">
      <div className="border-b px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-base font-semibold">Conversation</h2>
          <Badge variant="secondary" className="rounded-full px-2.5 font-mono text-[10px]">
            {fixtureMessagesRead}/{totalFixtureMessages} read
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
                <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                  {message.id}
                </span>
                <span className="text-[10px] text-muted-foreground/70">{message.timestamp}</span>
                {index === messages.length - 1 && (
                  <Badge className="ml-auto h-5 rounded-full bg-primary/10 px-2 text-[9px] text-primary shadow-none">
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
        {canProcessFixture ? (
          <Button className="w-full rounded-xl" onClick={onProcessNext} disabled={isProcessing}>
            <HugeiconsIcon icon={PlayIcon} className="size-4" strokeWidth={2} />
            Process next message
          </Button>
        ) : (
          <div className="relative">
            <Textarea
              aria-label="Add a follow-up message"
              value={customMessage}
              onChange={(event) => onCustomMessageChange(event.target.value)}
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
        )}
        <button
          type="button"
          onClick={onReset}
          className="flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={Refresh01Icon} className="size-3.5" strokeWidth={2} />
          Reset conversation
        </button>
      </div>
    </section>
  );
}
