# Resolve

Resolve turns an arbitrary conversational log into a ranked, auditable task
decision. Import JSON, CSV, or TXT; either Codex CLI or an OpenAI-compatible
analysis API proposes source-grounded task readings, including stale,
contradicted, or underspecified alternatives when a clear leading reading would
otherwise collapse the candidate set. Ordinary conversation and missing-context
logs also preserve compatible source-grounded readings so missing referents and
known facts remain visible without inventing agent work. If an actionable task
still has fewer than three distinct readings after one corrective provider
retry, Resolve keeps the grounded readings and explicitly requires human review
instead of padding the catalogue. A
separately configured OpenAI-compatible embedding API then supplies the semantic
vectors used to score those interpretations alongside explicit constraints and
accepted user/domain history. Weak or closely matched evidence is sent to human
review with a grounded clarification question.

There is no fixture or deterministic demo in the shipped interface. The local
feature-hash provider exists only for fast, reproducible automated tests.

## What works

- Direct conversation initiation from the UI with initial message, custom name, and domain metadata.
- Canonical, Zod-validated conversations with ordered source IDs and optional
  author/role, domain, and accepted outcomes.
- Paste, file picker, and drag/drop imports with validation and preview.
- Candidate analysis through either Codex CLI or an OpenAI-compatible API.
- A pre-ranking gate that distinguishes actionable work, ordinary conversation,
  and context that cannot be recovered from the supplied messages.
- API-only trained embeddings with batching, retry, timeout, cache, provenance,
  model compatibility checks, and no silent fallback.
- Constraint supersession, unrelated task replacement, deferral, resumption,
  follow-up questions, and quoted/assistant text handling.
- Complete scores, relative confidence, rank/axis deltas, supporting/conflicting
  evidence, previous/current winners, and review reasons.
- One corrective retry for actionable catalogues with fewer than three distinct
  readings, followed by an explicit shortfall warning when the provider still
  cannot ground three genuine alternatives.
- Owner-scoped SQLite conversations, queued revisions, ranking runs, accepted or
  corrected outcomes, restart recovery, and user/domain-filtered retrieval.
- A collapsible task sidebar that polls waiting and analyzing work, starts a
  bounded worker for pending tasks while the monitor is open, and reopens
  completed conversations without rerunning the analysis provider.
- Divider-based task rows, optimistic conversation renaming, and transactional
  persistence of the new name across the queue and saved ranking snapshots.

## Log-to-ranking flow

```text
JSON / CSV / TXT
  -> parse and validate ConversationLog
  -> persist owner-scoped conversation revision
  -> Codex CLI or analysis API assesses actionability and context recoverability
  -> selected analysis provider generates source-grounded competing decisions/readings
  -> normalize IDs, features, boundaries, duplicates, and source references
  -> embedding API embeds messages, candidates, and history with one pinned model
  -> retry one short actionable catalogue; preserve and flag any remaining shortfall
  -> score semantic + constraints + history independently
  -> gate incompatible candidate kinds, calculate confidence, apply review policy
  -> persist RankingResult and show evidence, deltas, and clarification
  -> accepted/corrected outcome becomes scoped future history
```

See [architecture](docs/ARCHITECTURE.md) for boundaries and invariants and
[system overview](docs/SYSTEM_OVERVIEW.md) for an end-to-end explanation.

## Clean install

Requirements:

- Node.js 22+, Corepack, and pnpm 11.
- One candidate-analysis provider: either an installed and authenticated Codex
  CLI, or an OpenAI-compatible API model that supports structured output.
- An OpenAI-compatible embedding API endpoint, key, and pinned embedding model.
  API embeddings are required regardless of which candidate-analysis provider
  you select; the application has no production local embedding fallback.

```bash
git clone https://github.com/agmada-asa/LECAIBuildAssessment.git
cd LECAIBuildAssessment
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Edit `.env.local` before starting the app. The API base URL, key, and embedding
settings are always required. `OPENAI_COMPATIBLE_ANALYSIS_MODEL` is required only
when the OpenAI-compatible API—not Codex CLI—will generate candidates.

Open http://localhost:3000, choose **Start a conversation** to begin from
scratch or **Analyze a log** to import an existing log file, select an
operational provider, and start analysis.

Production:

```bash
pnpm build
pnpm start
```

SQLite defaults to `data/resolve.sqlite`; the directory is created on first use.

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

TXT lines, JSON entries, and CSV rows receive stable `M1`, `M2` IDs in source
order; supplied IDs are ignored so repeated labels cannot invalidate an import.
Missing times are normalized for the canonical contract but displayed as “time
unavailable,” never as a real year-2000 timestamp. Role-less messages are
intentionally treated as task context; when authors are present in JSON or CSV,
assistant/system/tool/developer text is not scored as a new user instruction.

## Configuration

Candidate analysis and semantic embedding are separate stages:

- **Candidate analysis:** choose Codex CLI or the OpenAI-compatible analysis API
  in the workbench. Only the selected provider generates interpretations,
  constraints, and task boundaries.
- **Semantic embeddings:** always use the configured OpenAI-compatible embedding
  API in production, including when Codex CLI performs candidate analysis.

The API base URL and key are shared by the embedding client and, when selected,
the API analysis client. All credentials remain server-side. Every supported
environment variable:

| Variable | Purpose |
| --- | --- |
| `OPENAI_COMPATIBLE_BASE_URL` | Required base `/v1` URL for embeddings; also used for API candidate analysis when selected. |
| `OPENAI_COMPATIBLE_API_KEY` | Required server-only bearer credential for embeddings and optional API candidate analysis. |
| `OPENAI_COMPATIBLE_ANALYSIS_MODEL` | Candidate-generation model; required only when the API analysis provider is selected. |
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
selected. A failed follow-up visibly leaves the last successful result stale and
disables accept/correct actions. A failed replacement import removes the prior
ranking so it cannot be mistaken for the new result. The interactive request
stops waiting after 90 seconds and offers a retry while durable queued work
remains independently recoverable. A successful direct analysis commits the
exact queued revision in the same request, so the queue does not require a
duplicate provider call to leave `pending`.
Loading the task sidebar also repairs legacy pending entries when an exact
owner/provider/conversation/message/weight match already exists in persisted
ranking history. Unmatched pending work is submitted to the bounded queue
worker automatically while the sidebar is monitoring it; the resume control
remains available for explicit recovery.

Renaming an analyzed conversation updates the heading and task sidebar
immediately. The server then atomically renames the owner-scoped queue entry,
conversation, and stored run snapshots. A conflicting or failed rename restores
the previous name and shows an error.

Analysis-provider readiness confirms that the endpoint is reachable and lists
the selected analysis model; it cannot guarantee capacity for the next
generation request. Runtime failures
therefore distinguish rejected credentials, denied or missing models, rate or
capacity limits, upstream 5xx responses, and invalid structured output without
showing provider response bodies or credentials. Malformed JSON or schema
output receives one fresh, schema-constrained repair attempt before the app
returns an error. For direct OpenAI API use, set
the base URL to `https://api.openai.com/v1`, use an OpenAI API key, select an
embedding model available to that project, and—when using API candidate
analysis—select a model that supports Chat Completions structured outputs.
OpenRouter and other compatible gateways use their own keys, model names,
quotas, and capacity policies.

## Scoring and uncertainty

Default weights are semantic 30%, constraints 50%, history 20%. Constraints
receive the largest weight because direct user requirements and prohibitions
should beat topical resemblance. Semantic similarity combines recency-weighted
trained cosine similarity with visible lexical overlap. History is deliberately
weaker and only retrieves accepted outcomes for the imported user and domain.
The retrieval query uses active user-task messages after the latest grounded
task boundary, matching the scorer and excluding assistant or superseded work.
Accepting an interpretation does not execute the inferred task. It stores the
selected grounded task interpretation as positive, owner-scoped evidence for
later rankings of similar conversations from the same imported user and exact
domain. Accepting a different interpretation or supplying a correction
supersedes the earlier positive outcome from that ranking run while retaining
it for audit. Conversation, insufficient-context, and ungrounded candidates
cannot become positive task history. The
workbench marks the accepted candidate, changes a reviewed task to complete, and
confirms this effect in the decision panel.

Relative candidate confidence uses softmax temperature `0.17`; it is not a
probability of intent. The review policy combines candidates into one task
family when their titles overlap and they share at least three and 70% of their
canonical features without choosing conflicting values for any feature
dimension. A candidate must match every existing family member, so a vague
middle candidate cannot transitively join two conflicting decisions. This
prevents provider-generated framing variants from splitting a clear task's
decision confidence while preserving genuinely competing decisions.
Human review is required below
`0.52` total evidence, below `0.55` task-family confidence, within a `0.12`
top-family margin, or when no valid/current candidate represents the task.
It is also mandatory when fewer than three genuinely distinct actionable-task
interpretations remain after the bounded corrective retry. The valid candidates
are still ranked and displayed; the UI reports the exact generated count rather
than manufacturing additional readings.
Low relative confidence and a close family margin do not force review when the
winner has at least `0.65` total evidence, `0.90` constraint consistency, two
distinct supporting constraint matches, a `0.10` weighted-score lead, and no
constraint conflict. This keeps
provider-generated task labels from overruling several exact source
instructions while retaining the minimum-evidence gate.
These policy values preserve all labelled ambiguity/weak-evidence escalations;
they are not statistical calibration.

The written ranking explanation identifies the axis that contributes the
largest weighted advantage between the winning task family and its strongest
genuinely competing family. This can differ
from the axis with the largest configured weight when that axis does not
actually separate the candidates.

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
API fails.

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

These standard checks verify both candidate-analysis routes and enforce that
production embeddings remain API-backed. They use deterministic embeddings and
mocked analysis responses, so they do not spend API quota or prove live account
capacity. Run the credentialed evaluation below to exercise the configured
production embedding model before a deployment or recorded demo.

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
