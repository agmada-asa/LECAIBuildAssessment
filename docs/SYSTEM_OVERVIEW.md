# System Overview

Resolve is a conversational intent-ranking workbench. It takes an ordered log of
natural-language messages, asks a configured provider to identify plausible task
readings, scores those readings with deterministic policy code, and returns a
ranked decision brief with evidence, confidence, and review routing.

The project is designed for the build brief: competing interpretations are
separate candidates, semantic similarity, constraint consistency, and historical
pattern matching are separate scoring axes, and later reframes are compared
against the prior conversation state rather than treated as isolated messages.

## User Flow

1. A reviewer starts a conversation or imports a JSON, CSV, or TXT log in the
   Next.js workbench.
2. The log is normalized into the canonical `ConversationLog` contract.
3. The selected analysis provider classifies the conversation and proposes one
   clear reading or multiple competing readings grounded in source messages.
4. Provider output is normalized, deduplicated, and validated before ranking.
5. The ranking engine scores each interpretation on semantic, constraint, and
   history axes, applies the configured weights, and computes relative
   confidence.
6. The result is persisted to SQLite, shown in the workbench, and optionally
   accepted or corrected by the reviewer.
7. Accepted/corrected outcomes become owner-, user-, domain-, and model-scoped
   historical evidence for future rankings.

## Main Boundaries

`src/app/page.tsx` renders the single workbench route and keeps the layout as a
server component.

`src/components/intent-ranker.tsx` composes the client-side workbench: import and
start dialogs, task queue sidebar, conversation panel, ranking panel, evidence
panel, provider settings, and weight settings.

`src/lib/conversations/schema.ts` defines the canonical input contract. Message
order is authoritative, source IDs are preserved, and accepted outcomes are part
of the imported state.

`src/app/api/rank/route.ts` is the unified ranking endpoint. It validates the
request, runs the selected provider, normalizes provider output, prepares
embeddings, retrieves relevant historical outcomes, ranks the conversation, and
persists the run.

`src/lib/providers/*` isolates candidate-generation providers. Codex CLI and
OpenAI-compatible APIs are live analysis paths. The deterministic provider is
test-only unless explicitly enabled, and it refuses sparse logs rather than
inventing unrelated candidates.

`src/lib/ranking/*` owns deterministic ranking policy. Providers can propose
candidates and source-grounded constraints, but they do not choose the winner.

`src/lib/embeddings/*` owns embedding configuration, API calls, caching,
compatibility checks, deduplication, chunking, and cosine similarity.

`src/lib/persistence/*` owns local SQLite persistence for conversations, queue
items, ranking runs, accepted outcomes, and restart recovery.

## Ranking Model

The ranker works from a `RankingInput` containing interpretations, constraint
rules, accepted history, optional task boundaries, and an actionability
assessment. It produces a `RankingResult` with sorted candidates, evidence,
active constraints, reframes, confidence, uncertainty state, and explanatory
text.

The default policy weights are:

| Axis | Default weight | Purpose |
| --- | ---: | --- |
| Semantic similarity | 30% | Measures how well a candidate matches the active task messages using embeddings plus inspectable lexical overlap. |
| Constraint consistency | 50% | Rewards candidates that satisfy explicit requirements and penalizes candidates that violate prohibitions or changed values. |
| Historical pattern matching | 20% | Compares candidates and the active task against previously accepted outcomes for the same owner, imported user, domain, and embedding model. |

Constraints are intentionally weighted most heavily because direct user
requirements should override topical resemblance and past habits. UI weight
changes recombine existing axes; they do not rerun provider analysis or swap
embedding models.

## Conversation State

The application owns state rather than relying on hidden model memory. Every
ranking call receives the full ordered conversation, and follow-up messages
create queued revisions before analysis. For comparison, the engine scores the
previous snapshot from the exact previous normalized input when available.

The ranker selects active task messages after the latest grounded task boundary.
This prevents older, superseded work from continuing to dominate semantic and
history scores after a true task switch.

Conversation transitions are tracked separately from raw score movement:

| Transition | Meaning |
| --- | --- |
| Question | A message asks about related or deferred work without necessarily changing scope. |
| Deferral | A message explicitly postpones part of the work. |
| Resumption | A message returns to the active deliverable. |
| Replacement | A message changes the whole task. |

## Contradictions and Reframes

Constraint extraction produces canonical dimensions and values such as
`format:slides`, `format:csv`, `audience:finance`, or `purpose:client-review`.
The engine keeps one active value per dimension. A later requirement or
prohibition supersedes incompatible earlier evidence while retaining the old
constraint for audit.

For example:

1. `Include the important charts and keep it concise` supports a concise client
   review deck.
2. `Actually, this is for finance ingestion, not a review. No slides -- they
   need the raw rows by Monday` replaces the purpose, forbids slides, and adds
   raw finance data as the active requirement.
3. The CSV interpretation rises because constraint consistency and semantic
   similarity now support it, while the deck interpretation falls because its
   prior format and purpose conflict with the new message.

Each ranked candidate retains previous scores, current scores, per-axis deltas,
confidence deltas, rank deltas, added evidence, removed evidence, unchanged
evidence, and a candidate-level explanation.

## Uncertainty Handling

Resolve does not always guess. It routes work to human review when:

- No candidate is grounded in the active task.
- The top candidate has weak total evidence.
- The winning task family has low relative confidence.
- The top task families are too close.
- The context is insufficient to recover the underlying action.
- A latest task switch is not represented by any current candidate.

The system also separates actionability from ranking. Ordinary conversation can
produce `No actionable task detected`, and missing context can produce an
insufficient-context result instead of forcing a false task choice.

## Provider Safety and Grounding

Live providers return structured output only. Normalization rejects ungrounded
assessment message IDs, ungrounded constraints, malformed feature tags,
contradictory constraint rules, padded paraphrases, and task boundaries that do
not contain a grounded new task request.

The Codex provider runs as a child process with argument arrays, stdin, a
read-only sandbox, and an environment allowlist. OpenAI-compatible provider
errors are converted into structured, redacted HTTP errors. Credentials stay on
the server and are not reflected in logs or responses.

## Persistence and Queue

SQLite is the shipped local backend. It stores owner-scoped conversations,
queued revisions, ranking snapshots, accepted or corrected outcomes, and
idempotency keys. The queue supports pending, processing, review, complete, and
failed states, and it can recover expired processing leases after restart.

A local browser owner ID scopes saved conversations and history on one machine.

## Verification

The standard local checks are:

```bash
pnpm test
pnpm lint
pnpm build
```

The current suite covers parser validation, provider normalization, provider
errors, ranking policy, contradiction handling, ambiguity routing, persistence,
queue behavior, component workflows, API routes, and browser walkthroughs.

## Production Limits

This repository is intentionally honest about what it is not. Candidate quality
still depends on the selected live provider, and confidence is policy-based
rather than empirically calibrated.
