/** @file Responsive task navigation with compact status indicators and recovery controls. */

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEVICE_ID_HEADER, getOrCreateDeviceId } from "@/lib/persistence/device";
import type {
  ConversationState,
  QueuedRankingTask,
} from "@/lib/persistence/types";

/** Keeps active task status responsive without continuously polling an idle queue. */
const ACTIVE_TASK_POLL_INTERVAL_MS = 3_000;

type TaskSidebarProps = {
  activeConversationId?: string;
  /** Identifies the pending queue record currently handled by a direct request. */
  processingConversationId?: string;
  renamedConversation?: {
    currentConversationId: string;
    nextConversationId: string;
  };
  /** Changes after analysis so the sidebar reloads the committed queue state. */
  refreshKey: string;
  onSelectConversation: (task: QueuedRankingTask) => void;
};

const STATUS_META: Record<
  ConversationState,
  { label: string; dotClassName: string; textClassName: string }
> = {
  pending: {
    label: "Waiting",
    dotClassName: "bg-amber-400",
    textClassName: "text-amber-700",
  },
  processing: {
    label: "Analyzing",
    dotClassName: "bg-sky-500 animate-pulse",
    textClassName: "text-sky-700",
  },
  human_review: {
    label: "Needs review",
    dotClassName: "bg-violet-500",
    textClassName: "text-violet-700",
  },
  decided: {
    label: "Complete",
    dotClassName: "bg-emerald-500",
    textClassName: "text-emerald-700",
  },
  failed: {
    label: "Failed",
    dotClassName: "bg-rose-500",
    textClassName: "text-rose-700",
  },
};

/** Displays owner-scoped tasks as a collapsible navigation rail or full sidebar. */
export function TaskSidebar({
  activeConversationId,
  processingConversationId,
  renamedConversation,
  refreshKey,
  onSelectConversation,
}: TaskSidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const [tasks, setTasks] = useState<QueuedRankingTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const automaticProcessActive = useRef(false);

  /** Fetches the current browser owner's reconciled queue without changing UI state. */
  const fetchTasks = useCallback(async (signal?: AbortSignal): Promise<QueuedRankingTask[]> => {
    const response = await fetch("/api/queue", {
      headers: { [DEVICE_ID_HEADER]: getOrCreateDeviceId() },
      signal,
    });
    const body = (await response.json()) as {
      tasks?: QueuedRankingTask[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Tasks are unavailable.");
    return body.tasks ?? [];
  }, []);

  /** Runs one bounded worker pass and returns the resulting queue snapshot. */
  const processWaitingTasks = useCallback(
    async (limit = 5, signal?: AbortSignal): Promise<QueuedRankingTask[]> => {
      const response = await fetch("/api/queue/process", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
        },
        body: JSON.stringify({ limit }),
        signal,
      });
      const body = (await response.json()) as {
        tasks?: QueuedRankingTask[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Waiting tasks could not be resumed.");
      }
      return body.tasks ?? [];
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchTasks(controller.signal)
      .then((nextTasks) => {
        setTasks(nextTasks);
        setError("");
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Tasks are unavailable.");
      });
    return () => controller.abort();
  }, [fetchTasks, refreshKey]);

  const hasActiveTasks = tasks.some(
    (task) => task.state === "pending" || task.state === "processing",
  );
  const pendingTaskKey = tasks
    .filter((task) => task.state === "pending")
    .map((task) => `${task.id}:${task.revision}`)
    .join("|");

  useEffect(() => {
    if (!pendingTaskKey || processingConversationId || automaticProcessActive.current) return;

    const controller = new AbortController();
    automaticProcessActive.current = true;
    processWaitingTasks(5, controller.signal)
      .then((nextTasks) => {
        setTasks(nextTasks);
        setError("");
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Waiting tasks could not be resumed.");
      })
      .finally(() => {
        automaticProcessActive.current = false;
      });

    return () => controller.abort();
  }, [pendingTaskKey, processWaitingTasks, processingConversationId]);

  useEffect(() => {
    if (!hasActiveTasks) return;

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    let stopped = false;

    /** Polls sequentially so a slow queue read cannot overlap the next request. */
    async function pollActiveTasks() {
      try {
        setTasks(await fetchTasks(controller.signal));
        setError("");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Tasks are unavailable.");
      } finally {
        if (!stopped) {
          timeout = setTimeout(pollActiveTasks, ACTIVE_TASK_POLL_INTERVAL_MS);
        }
      }
    }

    timeout = setTimeout(pollActiveTasks, ACTIVE_TASK_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [fetchTasks, hasActiveTasks]);

  /** Reloads tasks in response to an explicit refresh action. */
  async function loadTasks() {
    setLoading(true);
    setError("");
    try {
      setTasks(await fetchTasks());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tasks are unavailable.");
    } finally {
      setLoading(false);
    }
  }

  /** Resumes durable work that did not finish its original request. */
  async function resumeWaitingTasks(limit = 5) {
    setLoading(true);
    setError("");
    try {
      setTasks(await processWaitingTasks(limit));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Waiting tasks could not be resumed.");
    } finally {
      setLoading(false);
    }
  }

  /** Returns a failed task to the queue and immediately runs its retry. */
  async function retryTask(taskId: string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/queue", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [DEVICE_ID_HEADER]: getOrCreateDeviceId(),
        },
        body: JSON.stringify({ taskId }),
      });
      if (!response.ok) throw new Error("That analysis could not be retried.");
      await resumeWaitingTasks(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That analysis could not be retried.");
      setLoading(false);
    }
  }

  const waitingCount = tasks.filter((task) => task.state === "pending").length;

  return (
    <>
      {expanded && (
        <button
          type="button"
          aria-label="Close task sidebar overlay"
          className="fixed inset-0 top-16 z-20 bg-black/20 lg:hidden"
          onClick={() => setExpanded(false)}
        />
      )}
      <aside
        aria-label="Tasks"
        className={cn(
          "fixed top-16 bottom-0 left-0 z-30 flex shrink-0 flex-col border-r bg-background shadow-sm transition-[width] duration-200 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:shadow-none",
          expanded ? "w-72" : "w-14",
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center border-b", expanded ? "gap-2 px-3" : "justify-center")}>
          {expanded && <h2 className="min-w-0 flex-1 text-sm font-semibold">Tasks</h2>}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={expanded ? "Collapse task sidebar" : "Expand task sidebar"}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              {expanded ? "‹" : "›"}
            </span>
          </Button>
        </div>

        <div className={cn("min-h-0 flex-1 overflow-y-auto", expanded ? "px-3" : "px-2 py-3")}>
          {loading && tasks.length === 0 && (
            <p className={cn("text-xs text-muted-foreground", expanded ? "p-2" : "sr-only")}>
              Loading tasks…
            </p>
          )}
          {!loading && tasks.length === 0 && !error && expanded && (
            <p className="p-2 text-xs leading-5 text-muted-foreground">
              Imported conversations will appear here.
            </p>
          )}
          <div className={expanded ? "divide-y" : "space-y-1.5"}>
            {tasks.map((task) => {
              const renamed = renamedConversation?.currentConversationId === task.externalConversationId;
              const displayConversationId = renamed
                ? renamedConversation.nextConversationId
                : task.externalConversationId;
              // A direct request leaves its recovery record pending until the
              // result commits, but it is active work rather than waiting work.
              const displayState =
                task.state === "pending" && processingConversationId === displayConversationId
                  ? "processing"
                  : task.state;
              const status = STATUS_META[displayState];
              const presentedTask: QueuedRankingTask = renamed
                ? {
                    ...task,
                    externalConversationId: displayConversationId,
                    request: {
                      ...task.request,
                      conversation: {
                        ...task.request.conversation,
                        conversationId: displayConversationId,
                      },
                    },
                  }
                : task;
              const active = activeConversationId === displayConversationId;
              const winner = task.result?.result.ranking[0];

              if (!expanded) {
                return task.result ? (
                  <button
                    key={task.id}
                    type="button"
                    aria-label={`Open ${displayConversationId}`}
                    aria-current={active ? "page" : undefined}
                    title={`${displayConversationId}: ${status.label}`}
                    className={cn(
                      "flex size-10 items-center justify-center transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active && "bg-primary/10",
                    )}
                    onClick={() => onSelectConversation(presentedTask)}
                  >
                    <span className={cn("size-2.5 rounded-full", status.dotClassName)} aria-hidden="true" />
                  </button>
                ) : (
                  <div
                    key={task.id}
                    role="status"
                    aria-label={`${displayConversationId}: ${status.label}`}
                    title={`${displayConversationId}: ${status.label}`}
                    className="flex size-10 items-center justify-center"
                  >
                    <span className={cn("size-2.5 rounded-full", status.dotClassName)} aria-hidden="true" />
                  </div>
                );
              }

              return (
                <article
                  key={task.id}
                  className={cn(
                    "py-3",
                    active && "-mx-3 border-l-2 border-primary bg-primary/5 px-3",
                  )}
                >
                  {task.result ? (
                    <button
                      type="button"
                      aria-label={`Open ${displayConversationId}`}
                      aria-current={active ? "page" : undefined}
                      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onSelectConversation(presentedTask)}
                    >
                      <p className="truncate text-sm font-medium">{displayConversationId}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", status.dotClassName)} aria-hidden="true" />
                        <span className={cn("text-[11px] font-medium", status.textClassName)}>
                          {status.label}
                        </span>
                      </div>
                      {winner && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{winner.title}</p>}
                    </button>
                  ) : (
                    <div>
                      <p className="truncate text-sm font-medium">{displayConversationId}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", status.dotClassName)} aria-hidden="true" />
                        <span className={cn("text-[11px] font-medium", status.textClassName)}>
                          {status.label}
                        </span>
                      </div>
                    </div>
                  )}
                  {task.error && <p className="mt-2 text-[11px] leading-4 text-destructive">{task.error}</p>}
                  {task.state === "failed" && (
                    <Button
                      className="mt-2 w-full"
                      size="sm"
                      variant="outline"
                      disabled={loading}
                      onClick={() => void retryTask(task.id)}
                    >
                      Retry analysis
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        {expanded && (
          <div className="shrink-0 space-y-2 border-t p-3">
            {error && <p role="alert" className="text-xs leading-4 text-destructive">{error}</p>}
            {waitingCount > 0 && !processingConversationId && (
              <Button
                className="w-full"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => void resumeWaitingTasks()}
              >
                Resume {waitingCount} waiting {waitingCount === 1 ? "task" : "tasks"}
              </Button>
            )}
            <Button className="w-full" size="sm" variant="ghost" disabled={loading} onClick={() => void loadTasks()}>
              Refresh
            </Button>
          </div>
        )}
      </aside>
    </>
  );
}
