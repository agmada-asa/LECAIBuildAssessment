/** @file Import, validation, preview, and provider selection dialog. */

import { useState, type DragEvent } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ConversationImportError,
  parseConversationInput,
} from "@/lib/conversations/import";
import type { ConversationLog } from "@/lib/conversations/schema";
import type { ProviderId, ProviderStatus } from "@/lib/providers/types";

type ConversationImportDialogProps = {
  providers: ProviderStatus[];
  provider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  onAnalyze: (log: ConversationLog, provider: ProviderId) => Promise<void>;
};

/** Imports, validates, previews, and dispatches one arbitrary conversation. */
export function ConversationImportDialog({
  providers,
  provider,
  onProviderChange,
  onAnalyze,
}: ConversationImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState<string>();
  const [preview, setPreview] = useState<ConversationLog>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedProvider = providers.find((item) => item.id === provider);
  const providerReady = Boolean(selectedProvider?.operational);

  /** Validates current text without starting analysis. */
  function createPreview(nextSource = source, nextFilename = filename) {
    try {
      const log = parseConversationInput(nextSource, { filename: nextFilename });
      setPreview(log);
      setError("");
    } catch (caught) {
      setPreview(undefined);
      setError(
        caught instanceof ConversationImportError
          ? caught.message
          : "This conversation could not be parsed.",
      );
    }
  }

  /** Reads a selected or dropped file as UTF-8, then renders its preview. */
  async function loadFile(file: File) {
    try {
      const text = await file.text();
      setSource(text);
      setFilename(file.name);
      createPreview(text, file.name);
    } catch {
      setError("The selected file could not be read as text.");
    }
  }

  /** Accepts the first file dropped onto the import target. */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  /** Closes the preview immediately, then lets the workbench present request progress. */
  async function submit() {
    if (!preview || submitting) return;
    setSubmitting(true);
    setOpen(false);
    try {
      await onAnalyze(preview, provider);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="rounded-full" />}>
        Analyze a log
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Analyze a conversation</DialogTitle>
          <DialogDescription>
            Paste a log or import JSON, CSV, or TXT. You can verify every message before analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
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
            <label htmlFor="analysis-provider" className="mb-2 block text-xs font-semibold">
              Provider
            </label>
            <Select
              value={provider}
              onValueChange={(value) => onProviderChange(String(value) as ProviderId)}
            >
              <SelectTrigger
                id="analysis-provider"
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

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="rounded-xl border border-dashed bg-muted/25 p-4 text-center"
          >
            <label htmlFor="conversation-file" className="cursor-pointer text-xs font-semibold">
              Choose a conversation file
            </label>
            <input
              id="conversation-file"
              aria-label="Choose conversation file"
              type="file"
              accept=".json,.csv,.txt,application/json,text/csv,text/plain"
              className="mt-2 block w-full text-xs text-muted-foreground"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
              }}
            />
            <p className="mt-2 text-[10px] text-muted-foreground">or drag and drop it here</p>
          </div>

          <div>
            <label htmlFor="conversation-paste" className="mb-2 block text-xs font-semibold">
              Paste conversation log
            </label>
            <Textarea
              id="conversation-paste"
              aria-label="Paste conversation log"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setFilename(undefined);
                setPreview(undefined);
                setError("");
              }}
              placeholder="request-17: Prepare the June report.\nfollow-up: Send the raw rows."
              className="min-h-28 resize-y rounded-xl font-mono text-xs"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full rounded-xl"
            onClick={() => createPreview()}
          >
            Preview conversation
          </Button>

          {error && (
            <Alert role="alert" className="border-rose-200 bg-rose-50 text-rose-950">
              <HugeiconsIcon icon={Alert02Icon} className="size-4" strokeWidth={2} />
              <AlertTitle className="text-xs">Check the conversation</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <section className="rounded-xl border p-3" aria-labelledby="message-preview-title">
              <div className="mb-3 flex items-center justify-between">
                <h3 id="message-preview-title" className="text-xs font-semibold">
                  Message preview
                </h3>
                <span className="text-[10px] text-muted-foreground">
                  {preview.messages.length} messages
                </span>
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {preview.messages.map((message) => (
                  <div key={message.id} className="rounded-lg bg-muted/50 p-2.5">
                    <p className="font-mono text-[10px] font-semibold">{message.id}</p>
                    <p className="mt-1 text-xs leading-5">{message.text}</p>
                  </div>
                ))}
              </div>
              <Button
                className="mt-3 w-full rounded-xl"
                disabled={submitting || !providerReady}
                onClick={() => void submit()}
              >
                {submitting ? "Analyzing…" : `Analyze ${preview.messages.length} messages`}
              </Button>
            </section>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
}
