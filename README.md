# Resolve

Resolve turns an arbitrary conversational log into a ranked, auditable task
decision. Import JSON, CSV, or TXT; a configured live analysis provider proposes
three to five genuinely competing interpretations; Resolve scores each one for
semantic similarity, explicit constraints, and accepted user/domain history.
Weak or closely matched evidence is sent to human review with a grounded
clarification question.

There is no fixture or deterministic demo in the shipped interface. The local
feature-hash provider exists only for fast, reproducible automated tests.

## What works

- Canonical, Zod-validated conversations with ordered source IDs and optional
  author/role, domain, and accepted outcomes.
- Paste, file picker, and drag/drop imports with validation and preview.
- Live Codex CLI or OpenAI-compatible candidate extraction.
- A pre-ranking gate that distinguishes actionable work, ordinary conversation,
  and context that cannot be recovered from the supplied messages.
- API-only trained embeddings with batching, retry, timeout, cache, provenance,
  model compatibility checks, and no silent fallback.
- Constraint supersession, unrelated task replacement, deferral, resumption,
  follow-up questions, and quoted/assistant text handling.
- Complete scores, relative confidence, rank/axis deltas, supporting/conflicting
  evidence, previous/current winners, and review reasons.
- Owner-scoped SQLite conversations, queued revisions, ranking runs, accepted or
  corrected outcomes, restart recovery, and user/domain-filtered retrieval.
- A collapsible task sidebar that polls waiting and analyzing work for live
  status updates, then reopens completed conversations without rerunning the
  analysis provider.
- Divider-based task rows, optimistic conversation renaming, and transactional
  persistence of the new name across the queue and saved ranking snapshots.

## Log-to-ranking flow

```text
JSON / CSV / TXT
  -> parse and validate ConversationLog
  -> persist owner-scoped conversation revision
  -> live provider assesses actionability and context recoverability
  -> provider generates 3-5 typed candidates and grounded constraints
  -> normalize IDs, features, boundaries, duplicates, and source references
  -> API embeds messages, candidates, and accepted history with one pinned model
  -> score semantic + constraints + history independently
  -> gate incompatible candidate kinds, calculate confidence, apply review policy
  -> persist RankingResult and show evidence, deltas, and clarification
  -> accepted/corrected outcome becomes scoped future history
```

See [architecture](docs/ARCHITECTURE.md) for boundaries and invariants.

## Clean install

Requirements: Node.js 22+, Corepack, pnpm 11, and either an installed/authenticated
Codex CLI or an OpenAI-compatible analysis API.

```bash
git clone <repository-url>
cd LECAIBuildAssessment
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000, choose **Analyze a log**, select an operational
provider, preview the log, and start analysis.

Production:

```bash
pnpm build
pnpm start
```

SQLite defaults to `data/resolve.sqlite`; the directory is created on first use.
This repository does not ship Supabase, pgvector, hosted migrations, or RLS.
A shared deployment would require authenticated tenancy and a production data
store; do not treat the browser device ID as authorization.

## Import formats

Canonical JSON:

```json
{
  "conversationId": "request-17",
  "userId": "finance-user",
  "domain": { "name": "finance" },
  "messages": [
    {
      "id": "M1",
      "author": "user",
      "text": "Write a concise rate-limiting proposal.",
      "timestamp": "2026-08-14T09:00:00.000Z"
    }
  ],
  "acceptedOutcomes": []
}
```

JSON message arrays are also accepted. CSV requires `text`; `timestamp` and
`author` are optional:

```csv
text,timestamp,author
Write the proposal,2026-08-14T09:00:00Z,user
No dashboard yet,2026-08-14T09:01:00Z,user
```

TXT uses one message per non-empty line and does not interpret colon-prefixed
labels. TXT lines, JSON entries, and CSV rows receive stable `M1`, `M2` IDs in
source order; supplied IDs are ignored so repeated labels cannot invalidate an
import. Missing times are normalized for the canonical contract but displayed
as “time unavailable,” never as a real year-2000 timestamp. Role-less messages
are intentionally treated as task context; when authors are present in JSON or
CSV, assistant/system/tool/developer text is not scored as a new user
instruction.

## Configuration

All credentials remain server-side. Every supported environment variable:

| Variable | Purpose |
| --- | --- |
| `OPENAI_COMPATIBLE_BASE_URL` | Base `/v1` URL used by analysis and embedding APIs. |
| `OPENAI_COMPATIBLE_API_KEY` | Server-only bearer credential. |
| `OPENAI_COMPATIBLE_ANALYSIS_MODEL` | Structured candidate-generation model. |
| `EMBEDDING_PROVIDER` | Must be `openai-compatible` outside tests. |
| `EMBEDDING_ROLLOUT_MODE` | Operational label such as `shadow` or `trained`; never enables fallback. |
| `OPENAI_COMPATIBLE_EMBEDDING_MODEL` | Selected trained embedding model ID. |
| `OPENAI_COMPATIBLE_EMBEDDING_REVISION` | Recorded revision/canonical slug used for cache compatibility. |
| `OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS` | Exact expected vector length. |
| `OPENAI_COMPATIBLE_EMBEDDING_MAX_INPUT_TOKENS` | Per-input model limit. |
| `OPENAI_COMPATIBLE_EMBEDDING_MAX_INPUT_CHARACTERS` | Conservative pre-tokenization chunk limit. |
| `OPENAI_COMPATIBLE_EMBEDDING_MAX_BATCH_SIZE` | Maximum inputs in one API request. |
| `EMBEDDING_TIMEOUT_MS` | Per-request embedding timeout. |
| `EMBEDDING_MAX_RETRIES` | Retry count for transient failures/rate limits. |
| `SQLITE_DATABASE_PATH` | Optional local SQLite file path. |
| `RUN_TRAINED_EMBEDDING_EVAL` | Set to `1` only for credentialed integration evaluation. |
| `EMBEDDING_INTEGRATION` | Set to `true` with the integration evaluation so Vitest uses the API. |

Provider discovery reports `configured` separately from `operational`. Codex is
checked with a bounded version command; API readiness lists models with a
three-second timeout. A configured provider that fails its probe cannot be
selected. Failed analysis visibly leaves the previous result stale and disables
accept/correct actions. A successful direct analysis commits the exact queued
revision in the same request, so the queue does not require a duplicate provider
call to leave `pending`.
Loading the task sidebar also repairs legacy pending entries when an exact
owner/provider/conversation/message/weight match already exists in persisted
ranking history; unmatched work remains pending.

Renaming an analyzed conversation updates the heading and task sidebar
immediately. The server then atomically renames the owner-scoped queue entry,
conversation, and stored run snapshots. A conflicting or failed rename restores
the previous name and shows an error.

Readiness confirms that the endpoint is reachable and lists the selected model;
it cannot guarantee capacity for the next generation request. Runtime failures
therefore distinguish rejected credentials, denied or missing models, rate or
capacity limits, upstream 5xx responses, and invalid structured output without
showing provider response bodies or credentials. For direct OpenAI API use, set
the base URL to `https://api.openai.com/v1`, use an OpenAI API key, and select a
model available to that project that supports Chat Completions structured
outputs. OpenRouter and other compatible gateways use their own keys, model
names, quotas, and capacity policies.

## Scoring and uncertainty

Default weights are semantic 30%, constraints 50%, history 20%. Constraints
receive the largest weight because direct user requirements and prohibitions
should beat topical resemblance. Semantic similarity combines recency-weighted
trained cosine similarity with visible lexical overlap. History is deliberately
weaker and only retrieves accepted outcomes for the imported user and domain.
Accepting an interpretation does not execute the inferred task. It stores the
selected interpretation as positive, owner-scoped evidence for later rankings
of similar conversations from the same imported user and exact domain. The
workbench marks the accepted candidate, changes a reviewed task to complete, and
confirms this effect in the decision panel.

Relative candidate confidence uses softmax temperature `0.17`; it is not a
probability of intent. The review policy combines candidates into one task
family when their titles overlap and they share at least three and 70% of their
canonical features. This prevents provider-generated framing variants from
splitting a clear task's decision confidence. Human review is required below
`0.52` total evidence, below `0.55` task-family confidence, within a `0.12`
top-family margin, or when no valid/current candidate represents the task.
These policy values preserve all labelled ambiguity/weak-evidence escalations;
they are not statistical calibration.

Actionability is decided before candidate ranking. A clear social or status
exchange can therefore return **No actionable task detected** without forcing a
deliverable, while missing referents or incoherent text returns an explicit
insufficient-context result and records what remains unknown. Candidate
confidence compares only readings compatible with that gate; it does not imply
confidence that a task exists. Constraint evidence always displays the exact
matched source phrase rather than a provider-written label.

## Embedding selection and evaluation

Production uses the configured API model `openai/text-embedding-3-small`
(1,536 dimensions, configured 8,191-token limit). It does not fall back when the
API fails. The measured ablation and cost/privacy/deployment trade-offs are in
[the embedding report](src/evaluation/EMBEDDING_REPORT.md).

The 22-case fixed-catalogue scorer set records 22/22 winner and review decisions
with the deterministic test oracle. The credentialed trained-model run measured
18/22 top-one (81.8%) with 826 ms p95 per case on 14 August 2026. Lexical-only
also measured 18/22. Provider-inclusive raw-log tests separately cover grounding,
distinctness, open sets, roles, negation, deferral/resumption, and false review.
The actionability corpus adds 20 unique easy, medium, hard, impossible, and
incoherent conversations; shuffled blind duplicates are excluded. Impossible
and incoherent cases must abstain rather than invent an underlying task.

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Credentialed embedding evaluation:

```bash
set -a; source .env.local; set +a
EMBEDDING_INTEGRATION=true RUN_TRAINED_EMBEDDING_EVAL=1 \
  pnpm exec vitest run src/evaluation/trained-embedding.integration.test.ts
```

## Known limitations

- The selected OpenRouter model alias does not expose immutable weight hashes;
  the canonical slug is recorded as its revision.
- The trained-model result clears the absolute accuracy gate but does not beat
  lexical-only on the small fixed-catalogue set.
- Candidate-generation quality still depends on the selected live provider.
- Relative confidence is policy-based and uncalibrated.
- SQLite and device ownership suit a local assessment, not shared multi-tenant
  production.
- Provider health checks prove bounded readiness, not future availability.

## With more time

Collect independently authored logs and adjudicated outcomes; benchmark at least
two immutable/versioned API embedding candidates; calibrate confidence on a held-
out set; add authenticated tenancy and encrypted managed persistence; and run
long-duration queue/provider failure tests under production traffic patterns.
