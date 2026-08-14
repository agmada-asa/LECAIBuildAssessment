# Architecture

This document explains the system boundaries and the reasoning behind them. It complements the code comments rather than duplicating implementation details line by line.

## Data flow

```text
Canonical ConversationLog (JSON / CSV / TXT import)
        │
        ▼
Selected provider → ProviderAnalysis (3–5 candidates)
        │
        ▼
Provider normalization
        ├── stable candidate keys and distinctness
        ├── grounded constraints with source IDs
        ├── embedding-assisted duplicate consolidation
        └── relevant accepted historical outcomes
        │
        ▼
Independent scorers
        ├── semantic similarity
        ├── constraint consistency
        └── historical pattern matching
        │
        ▼
Normalised weighting policy
        │
        ▼
Ranked candidates + relative confidence
        │
        ├── clear result → decision brief
        └── weak/close result → human review + clarifying question
```

## State ownership

The application—not the model—owns conversational state. Every imported format
is converted to `ConversationLog`, and a ranking run receives the full ordered
message list, provider-normalized candidates, active policy weights, and accepted
history. It also recomputes the immediately previous turn so movement can be
explained accurately. Source message IDs are never replaced or sorted.

The unified API returns the normalized ranking input with the initial result.
The browser can therefore apply weight changes deterministically without another
provider call, while follow-up messages still rerun candidate extraction because
they may introduce a genuinely new interpretation. A follow-up also sends the
preceding normalized input back through the validated API boundary. Previous
scores and winners are therefore recomputed from the catalogue the user actually
saw, while new or removed candidates are described without fabricated deltas.

Provider requests are abortable and sequence-tagged in the browser workflow.
Changing or resetting the visible conversation invalidates pending work, so a
late provider response cannot install candidates from an obsolete log.

This makes the demo reproducible and prevents provider session memory from becoming an undocumented fourth signal.

Imported conversations and appended messages are also revisioned in the local
queue before analysis. A bounded callable worker claims leased tasks, commits
by revision/token compare-and-swap, recovers expired processing leases after a
restart, and reranks only the changed conversation. The queue view exposes full
ranked evidence for `human_review` tasks and permits failed-task retries.

## Rendering boundary

The root layout remains a Next.js Server Component and owns only metadata,
document structure, and self-hosted font variables. The workbench is the client
boundary because it needs state and event handlers. Its tooltip provider is
mounted inside that boundary rather than around the entire document, keeping
static layout code out of the client module graph.

Inter is the body font. Geist is limited to headings and monospace values via
separate `next/font` CSS variables, avoiding external browser font requests.

## Semantic score

`EmbeddingProvider` records provider, model, immutable revision, fixed
dimensions, input limit, deployment location, and production/demo purpose. One
provider instance embeds candidate title/summary/terms, each active-task
message, and accepted/corrected outcome text. The scorer calculates cosine
similarity per message, applies `0.5 ^ age` recency decay, and retains the
closest source message as evidence. A separately labelled lexical component
keeps exact matching inspectable and suppresses explicitly negated phrase
support. The two components form a bounded hybrid score.

The application accepts only a pinned OpenAI-compatible API model and fails
closed when its configuration is incomplete. The deterministic feature hash is
an injected unit-test fixture, not a selectable runtime, production model, or
rollback. The cache namespace includes provider,
model, revision, dimensions, and normalized input. Model changes produce an
explicit re-embedding plan and tagged cosine rejects incompatible vectors. The
remote adapter chunks long inputs with source-offset provenance, batches work,
applies timeout/transient-retry policy, validates indexes and dimensions, and
reports only aggregate cache, latency, volume, retry, and failure metrics.
Initial server results retain those computed
axes; browser weight changes recombine the same axes rather than substituting a
different model.

## Constraint score

Each extracted constraint contains:

- A message and matched phrase.
- A canonical dimension and value.
- `require` or `forbid` mode.
- Strength from `0` to `1`.

Candidates expose canonical features such as `format:slides` and `granularity:raw`. Exact required features score `1`; direct conflicts score near `0`; unspecified features remain neutral rather than being treated as false.

The engine selects one canonical active value for every populated dimension. A
later required value supersedes an earlier value in the same dimension, while a
later prohibition supersedes a requirement for the prohibited value. This
handles both polarity reversals (`slides` → `no slides`) and value changes
(`slides` → `CSV`). Same-value restatements update provenance without being
reported as a reframe.

Whole-task changes are provider-grounded rather than encoded as a catalogue of
known topics. `ProviderAnalysis.taskBoundaries` names the exact source message
where an unrelated replacement begins and explains the semantic change. The
ranker then supersedes every earlier active dimension before applying the new
message's provider-defined constraints. For a cue-free switch, normalization
requires a grounded required `topic` or `task` constraint in the replacement
message; explicit reset wording remains sufficient on its own.
Semantic and historical scores are calculated from the active task's messages
only, while the full conversation remains available for the constraint audit
trail. Providers are instructed to emit a canonical `topic` or `task` dimension,
but the ranker does not know or enumerate possible values. A small
transition-phrase detector remains only as an offline fallback when semantic
provider metadata is absent.

Matching is boundary-aware and polarity-aware: an explicit negative does not
also trigger its positive substring rule. Text inside quotation marks and
phrases introduced as earlier/reported instructions are excluded from new
constraint extraction. The same safeguards apply to deterministic whole-task
reset cues, so quoted or negated text such as `do not ignore the previous task`
cannot clear active state. Each reframe retains exact old and replacement
constraint objects, matched source text, and source-message IDs.

## Historical score

Historical examples are accepted or corrected outcomes, not merely earlier
chat messages. SQLite retrieval first filters by browser owner, imported user,
exact domain, acceptance state, and model identity, then calculates cosine
similarity and retains outcome provenance. The scorer maps
that outcome to each current candidate by embedding similarity, so generated
candidate IDs do not need to match historical IDs. This keeps historical
pattern matching distinct from current-conversation semantic similarity.

## Confidence and abstention

Weighted evidence scores are converted to relative confidence with softmax at temperature `0.17`. This makes the ordering legible but does not establish empirical calibration.

The abstention layer looks at evidence sufficiency, leader confidence, and the leader/runner-up margin. It is deliberately separate from candidate generation, so any provider must obey the same human-review policy.

Review output includes a stable reason code and a clarification question based
on the first differing top-two feature dimension. A provider-grounded task
switch is also forced to review when none of the current candidates represents
the new required topic/task feature; stale candidates cannot remain decision
ready.

## Durable state and security

The local SQLite database stores complete conversation/ranking snapshots and
task outcomes. `(conversation_id, idempotency_key)` prevents retry duplication,
and each run records the complete normalized weight policy and original message
order. Outcome vectors are stored as JSON and cosine-ranked in process because
the local assessment data set does not justify a separate vector extension.

A random UUID in browser local storage identifies one browser owner separately
from the canonical user named by an imported log. Every state lookup, ranking
write, queue claim, history query, and feedback ownership check is scoped to
that owner; history additionally requires the imported user and exact domain.
This avoids hardware fingerprinting and cross-log history contamination, but it is
pseudonymous local isolation rather than authentication for a shared service.

SQLite is the shipped backend. No Supabase, pgvector, or hosted RLS path is
presented as operational; a shared deployment would require authenticated
tenant identity and a separate reviewed migration.

## User-controlled weights

Weights are normalised before use, which prevents accidental totals above or below 100 from corrupting the calculation. The three assessment axes cannot be disabled in the UI; sliders retain a minimum contribution.

Weight changes affect ranking influence, not the underlying evidence. Conflict badges and human-review checks remain visible under every profile.

## Provider boundary

`ProviderAnalysis` is intentionally narrow:

- Three to five mutually exclusive interpretations.
- Semantic terms for each interpretation.
- Canonical candidate features.
- Extracted constraints grounded in conversation phrases.
- Source-grounded semantic task boundaries for unrelated topic replacements.

Providers do not choose the winner. This prevents Codex, an API model, or another
future adapter from silently replacing the application's scoring policy.

Provider output is normalized before ranking. Candidate IDs are derived from
titles, feature tags must use `dimension:value`, constraints must match a source
message and a candidate feature dimension, substantially overlapping candidates
are merged, and fewer than three distinct results are rejected. Message order and
source IDs carry provenance. Explicit assistant/system/tool authors are not
scored as new instructions; role-less logs intentionally retain all messages.
Constraint display labels must retain meaningful language from their grounded
source phrases; claims inferred only from omission are discarded. Cue-free task
boundaries must introduce a required `topic` or `task` constraint in the same
message. Format-, audience-, tone-, and detail-only follow-ups therefore inherit
the established subject instead of clearing the earlier context.

The Codex adapter uses `spawn` with an argument array and stdin. It never builds
a shell command from user content. Live extraction runs from the temporary
schema directory rather than the repository, uses a read-only sandbox, and
ignores user configuration and rule files so configured MCP servers and hooks
are not loaded. The child process receives an allowlist of runtime paths instead
of the parent server's full environment. JSON Schema constrains the response and
Zod validates it before it crosses the provider boundary. Raw provider errors
remain server-side and are represented by structured, redacted HTTP errors.
Availability is checked before execution, each run has a timeout, and one
transient failure is retried. The deterministic fallback enters through the
same normalization and ranking path and is labelled in the response.

## Explanation boundary

The decision brief is a template over:

- Current and previous winners.
- Active policy weights.
- Strongest computed signal.
- A reframe caused by the newest message, when present.
- Uncertainty reason.

Every candidate also retains its complete previous snapshot and signed semantic,
constraint, history, total, confidence, and rank deltas. Material axis changes
are attributed to the newest source message. Evidence is partitioned into
added, removed, and unchanged sets, and every candidate receives its own rank
explanation with available supporting and conflicting evidence. Result-level
`rankingChange` text explains both sides of a winner change or neutrally records
that the same winner remained first, while
`mostInfluentialAxis` records the dominant normalised policy weight and why the
policy prioritises it.

It does not reveal or request hidden model reasoning. Reviewers can trace every sentence to stored values in the output model.

## Testing strategy

Domain tests cover invariant behaviours rather than exact floating-point
snapshots, including value changes, polarity reversals, paraphrases, quoted and
reported text, cue-free unrelated topic switches, complete task switches, stale reframe prevention, full score
deltas, cue-free reframes, and invalid weight policies. Provider tests cover
subprocess isolation, OpenAI-compatible key handling, normalization, retries,
timeouts, and structured errors.
Parser tests cover valid, incomplete, and malformed JSON, CSV, and TXT. JSDOM
component tests cover the initial candidate list, import preview, accessible
selection state, optional provider discovery, and the contradictory-message rank
shift.

The automated Chrome walkthrough and manual browser checks cover:

- Initial ranking visibility.
- Processing the contradictory third message.
- Visible rank movement and reframe evidence.
- Ambiguous scenario and clarification prompt.
- Ranking-policy preset controls.
- Local provider discovery.

The 22-case labelled scorer evaluation uses fixed catalogues and gates top-one
and escalation metrics. A separate provider-inclusive suite begins with raw
logs and measures grounding, duplicate rate, top-one accuracy, review accuracy,
and false review across the audited open-set/state cases. Playwright exercises
the contradiction walkthrough, dentist/flights/apology grounding, and the
seven-message finance resumption through the running Next.js app. The production
build performs the final TypeScript and route compilation check.
