# Architecture

This document explains the system boundaries and the reasoning behind them. It complements the code comments rather than duplicating implementation details line by line.

## Data flow

```text
Canonical ConversationLog (JSON / CSV / TXT import)
        │
        ▼
Selected provider → actionability/recoverability assessment
        │
        ▼
ProviderAnalysis (3–5 task candidates, or 1–5 non-task readings)
        │
        ▼
Provider normalization
        ├── assessment evidence and compatible candidate types
        ├── stable candidate keys and distinctness
        ├── grounded constraints with source IDs
        ├── embedding-assisted duplicate consolidation
        ├── one corrective retry for a short actionable catalogue
        ├── explicit human review when fewer than three task readings remain
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
        ├── ordinary exchange → no actionable task
        ├── missing context → explicit abstention + known unknowns
        ├── clear task → decision brief
        └── weak/close result → human review + clarifying question
```

## State ownership

The application—not the model—owns conversational state. Every imported format
is converted to `ConversationLog`, and a ranking run receives the full ordered
message list, provider-normalized candidates, active policy weights, and accepted
history. It also recomputes the immediately previous turn, using the preceding
server-owned normalized input when a queued revision has one and otherwise
scoring the current catalogue retrospectively against the conversation prefix.
Complete initial imports therefore show the latest message's rank and signal
movement without requiring the reviewer to append that message again. Import
entries are never sorted; they receive canonical
`M1`, `M2` IDs in source order so repeated or role-like source labels cannot
invalidate a conversation.

The unified API returns the normalized ranking input with the initial result.
The browser can therefore apply weight changes deterministically without another
provider call, while follow-up messages still rerun candidate extraction because
they may introduce a genuinely new interpretation. A follow-up first creates an
owner-scoped queued revision; the ranking endpoint loads its preceding normalized
input from that exact server-owned revision instead of accepting comparison state
from the browser. Previous scores and winners are therefore recomputed from the
catalogue the user actually saw. Candidate continuity treats exact IDs as lookup
hints and accepts them only when candidate kind and canonical feature values are
compatible. It then matches provider paraphrases using canonical features,
title/summary overlap, and semantic terms, so rewording does not masquerade as
addition or removal while a reused title cannot hide a changed decision. New or
removed decisions are described without fabricated deltas.

Provider requests are abortable and sequence-tagged in the browser workflow.
Changing or resetting the visible conversation invalidates pending work, so a
late provider response cannot install candidates from an obsolete log.

Passing the full canonical log prevents provider session memory from becoming
an undocumented fourth signal.

Imported conversations and appended messages are also revisioned in the local
queue before analysis. The direct browser request carries the exact queued task
ID and revision, allowing its successful result to commit that pending snapshot
without a second provider call. A bounded callable worker remains available for
pending and retried work; it claims leased tasks, commits by revision/token
compare-and-swap, recovers expired processing leases after a restart, and
reranks only the changed conversation. While the sidebar is monitoring pending
work it automatically invokes that bounded worker; the manual resume action
remains a recovery control. A collapsible task sidebar shows waiting, analyzing,
review, complete, and failed states. While work is waiting or analyzing, it polls
the owner-scoped queue every three seconds with sequential requests and stops
after all visible work reaches a terminal state. It retries failures and restores
completed conversations into the workbench without rerunning analysis. Queue
reads also reconcile legacy pending rows from an exact persisted idempotency key;
they never promote a merely similar or newer conversation revision.

The task sidebar renders flat, divided navigation rows. Conversation renames are
optimistic in the client and transactional in persistence: the queue identity,
conversation record, and stored run payloads change together, while stable
internal IDs remain unchanged. Name collisions reject the transaction and cause
the client to restore the previous label.

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

Task candidates retain the `0.5 ^ age` preference because later instructions
can replace earlier work. Ordinary-conversation candidates use uniform message
weighting and average lexical coverage so a closing acknowledgement or personal
commitment does not displace the meaning of the exchange as a whole.

The application accepts only a pinned OpenAI-compatible API model and fails
closed when its configuration is incomplete. The deterministic feature hash is
an injected test provider, not a selectable runtime, production model, or
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
requires both a grounded required `topic` or `task` constraint and an actionable
instruction in the replacement message. Actionable instructions include direct
requests and declarations such as “the task is …” or “we need …”; explicit reset
wording remains sufficient on its own.
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
When a constraint phrase grounds its canonical dimension/value but the provider
paraphrases the display label, normalization uses the exact source phrase as the
label. If neither the label nor canonical identity is grounded, normalization
rejects the catalogue for corrective provider retry. It never silently removes
the user's explicit instruction.

## Historical score

Historical examples are accepted or corrected outcomes, not merely earlier
chat messages. SQLite retrieval first filters by browser owner, imported user,
exact domain, acceptance state, and model identity, then calculates cosine
similarity and retains outcome provenance. Its query embedding uses the same
active user-task message selection as scoring, excluding assistant messages and
user tasks superseded by the latest grounded task boundary. The scorer maps
that outcome to each current candidate by embedding similarity, so generated
candidate IDs do not need to match historical IDs. This keeps historical
pattern matching distinct from current-conversation semantic similarity.
Saving either an acceptance or correction also atomically changes the exact
reviewed ranking run and matching queue snapshot from `human_review` to
`decided`; unrelated or newer queue revisions are not changed.
The feedback endpoint accepts only the saved run ID, selected candidate ID,
decision, and optional correction. Candidate text, imported user, and domain are
loaded from the owner-scoped persisted run so client-supplied metadata cannot
poison future history.
Only valid task candidates can be accepted as positive task history. A later
acceptance or correction from the same ranking run atomically deactivates the
earlier positive outcome while retaining that record for audit.

## Confidence and abstention

Before ranking, the provider classifies the conversation as an actionable task,
ordinary conversation, or insufficient context. Interpretations are typed as a
task, conversation, or insufficient-context reading. An actionable-task
assessment is normalized to source-grounded task readings and should contain at
least three distinct alternatives. After semantic duplicate consolidation, a
short actionable catalogue receives one corrective provider retry. If fewer
than three readings still remain, the valid readings are ranked and the exact
shortfall is routed to human review rather than filled with generated
paraphrases. Ordinary-conversation and insufficient-context assessments may
truthfully contain one compatible non-task reading. The deterministic scorer marks
incompatible candidate types invalid before ordering and relative confidence.
Legacy persisted inputs without this assessment retain the previous open ranking
behavior.

An ordinary-conversation result is a valid outcome rather than an error or a
manufactured task. An insufficient-context result is always routed to review
with absent referents or facts listed explicitly; the engine does not ask a
false either/or question between invented tasks. This categorical gate is kept
separate from relative candidate confidence, which only compares compatible
readings.

Weighted evidence scores are converted to relative candidate confidence with
softmax at temperature `0.17`. This makes the ordering legible but does not
establish empirical calibration. For the review decision, candidates with an
overlapping task title and at least three and 70% shared canonical features are
grouped into a task family only when they do not choose conflicting values for
any feature dimension. Grouping uses complete linkage: a candidate must match
every member already in a family. A vague candidate therefore cannot transitively
bridge two mutually exclusive decisions. The family receives the sum of its
candidates' relative confidence, making review stable when a provider emits
multiple framings of the same explicit task without hiding mutually exclusive
decisions. Candidate scores remain separate in the audit output.

The influential-axis explanation and clarification question compare the
winning family with its strongest alternative family, never with another
framing already counted as the same decision.

The abstention layer looks at evidence sufficiency, winning task-family
confidence, and the top-family margin. It is deliberately separate from
candidate generation, so any provider must obey the same human-review policy.

Review output includes a stable reason code and a clarification question based
on the first feature dimension that differs from the strongest competing task
family. A provider-grounded task
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

- Three to five source-grounded readings when possible. Actionable readings are
  tasks; ordinary-conversation and insufficient-context readings remain non-task
  interpretations.
- One conversation-level actionability/recoverability assessment with grounded
  source-message IDs, known facts, and material unknowns.
- A candidate kind (`task`, `conversation`, or `insufficient-context`) on every
  interpretation. Actionable alternatives must be anchored in source phrases,
  constraints, or declared unknowns; other assessments must include a compatible
  reading.
- Semantic terms for each interpretation.
- Canonical candidate features.
- Extracted constraints grounded in conversation phrases.
- Source-grounded semantic task boundaries for unrelated topic replacements.

Providers do not choose the winner. This prevents Codex, an API model, or another
future adapter from silently replacing the application's scoring policy.

Provider output is normalized before ranking. Candidate IDs are derived from
titles, feature tags must use `dimension:value`, constraints must match a source
message and a candidate feature dimension, and substantially overlapping candidates
are merged. Assessed logs that arrive with a short compatible catalogue are sent
through one corrective provider retry only when the assessment is actionable;
the application never synthesizes additional candidates from constraints,
messages, facts, or unknowns. A remaining shortfall becomes a mandatory review
reason. Legacy provider snapshots without an actionability assessment retain
the older three-candidate catalogue requirement. Message order and
source IDs carry provenance. Explicit assistant/system/tool authors are not
scored as new instructions; role-less logs intentionally retain all messages.
Constraint display uses the exact matched source phrase; provider-written labels
cannot masquerade as message evidence. Pure acknowledgements are discarded as
constraints and cannot create task boundaries. Cue-free task boundaries must
contain a new request or instruction and introduce a required `topic` or `task`
constraint in the same message. Format-, audience-, tone-, and detail-only
follow-ups therefore inherit the established subject instead of clearing the
earlier context.

The Codex adapter uses `spawn` with an argument array and stdin. It never builds
a shell command from user content. Live extraction runs from the temporary
schema directory rather than the repository, uses a read-only sandbox, and
ignores user configuration and rule files so configured MCP servers and hooks
are not loaded. The child process receives an allowlist of runtime paths instead
of the parent server's full environment. JSON Schema constrains the response and
Zod validates it before it crosses the provider boundary. Raw provider errors
remain server-side and are represented by structured, redacted HTTP errors.
Configured and operational status are separate. Discovery performs bounded
readiness probes before selection, each run has a timeout, and one transient
failure is retried. Malformed JSON or schema output also receives one fresh,
schema-constrained repair attempt. The browser stops awaiting one interactive
analysis after 90 seconds; durable queued work remains available for bounded
background recovery. A failed replacement import clears the earlier visible
ranking, while a failed follow-up may retain the last successful result only as
explicitly stale, non-actionable context. Deterministic candidate generation is
test-only and is not accepted by the production route.

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
`mostInfluentialAxis` records the axis with the largest weighted score advantage
between the winning task family and its strongest alternative. The explanation
reports both that observed contribution and the configured policy weight.

It does not reveal or request hidden model reasoning. Reviewers can trace every sentence to stored values in the output model.

## Testing strategy

Domain tests cover invariant behaviours rather than exact floating-point
snapshots, including value changes, polarity reversals, paraphrases, quoted and
reported text, cue-free unrelated topic switches, complete task switches, stale reframe prevention, full score
deltas, cue-free reframes, and invalid weight policies. Provider tests cover
subprocess isolation, OpenAI-compatible key handling, normalization, retries,
timeouts, and structured errors.
Parser tests cover valid, incomplete, and malformed JSON, CSV, and TXT. JSDOM
component tests cover the empty workbench, imported candidate list, import
preview, accessible selection state, optional provider discovery, pending-worker
dispatch, and contradictory-message rank shift.

The 22-case labelled scorer evaluation uses fixed catalogues and gates top-one
and escalation metrics. A separate provider-inclusive suite begins with raw
logs and measures grounding, duplicate rate, top-one accuracy, review accuracy,
and false review across the audited open-set/state cases. Provider or
normalization failures are reported separately and count against review accuracy;
they are never treated as successful abstentions. Playwright imports its own test
conversations to exercise contradiction handling,
dentist/flights/apology grounding, and finance-task resumption through the
running Next.js app. The production build performs the final TypeScript and route
compilation check.
