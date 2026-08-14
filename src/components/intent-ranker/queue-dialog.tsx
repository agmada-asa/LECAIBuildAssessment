/** @file Owner-scoped queue inspection and bounded worker controls. */

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DEVICE_ID_HEADER, getOrCreateDeviceId } from "@/lib/persistence/device";
import type { QueuedRankingTask } from "@/lib/persistence/types";

/** Shows every durable conversation revision owned by the current browser. */
export function QueueDialog() {
  const [tasks, setTasks] = useState<QueuedRankingTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /** Loads the current owner-scoped queue without exposing another user's work. */
  async function loadQueue() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/queue", {
        headers: { [DEVICE_ID_HEADER]: getOrCreateDeviceId() },
      });
      const body = (await response.json()) as { tasks?: QueuedRankingTask[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "The task queue is unavailable.");
      setTasks(body.tasks ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The task queue is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  /** Runs one bounded worker pass and replaces the list with its latest states. */
  async function processQueue() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/queue/process", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
        },
        body: JSON.stringify({ limit: 5 }),
      });
      const body = (await response.json()) as { tasks?: QueuedRankingTask[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Queued tasks could not be processed.");
      setTasks(body.tasks ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Queued tasks could not be processed.");
    } finally {
      setLoading(false);
    }
  }

  /** Returns one failed task to pending before the next worker pass. */
  async function retryTask(taskId: string) {
    const response = await fetch("/api/queue", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
      },
      body: JSON.stringify({ taskId }),
    });
    if (response.ok) await loadQueue();
    else setError("That task could not be retried.");
  }

  return (
    <Dialog onOpenChange={(open) => open && void loadQueue()}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="rounded-full" />}>
        Task queue
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Task queue</DialogTitle>
          <DialogDescription>
            Inspect durable conversation revisions, review uncertain results, and retry failures.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void processQueue()} disabled={loading}>
            Process pending
          </Button>
          <Button size="sm" variant="outline" onClick={() => void loadQueue()} disabled={loading}>
            Refresh
          </Button>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {!loading && tasks.length === 0 && (
          <p className="rounded-xl border bg-muted/25 p-4 text-xs text-muted-foreground">
            No conversations are queued yet.
          </p>
        )}
        <div className="space-y-2">
          {tasks.map((task) => {
            const winner = task.result?.result.ranking[0];
            return (
              <article key={task.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{task.externalConversationId}</h3>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Revision {task.revision} · {task.request.conversation.messages.length} messages · {task.attempts} attempts
                    </p>
                  </div>
                  <Badge variant="outline">{task.state.replace("_", " ")}</Badge>
                </div>
                {winner && (
                  <p className="mt-3 text-xs">
                    {winner.title} · {Math.round(winner.confidence * 100)}% relative confidence
                  </p>
                )}
                {task.result?.result.clarificationQuestion && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Ask: {task.result.result.clarificationQuestion}
                  </p>
                )}
                {task.error && <p className="mt-2 text-[11px] text-destructive">{task.error}</p>}
                {task.state === "failed" && (
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => void retryTask(task.id)}>
                    Retry task
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
