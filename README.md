# Resolve

Resolve is a local-first intent-ranking workbench for conversational task queues. It keeps state across messages, retrieves at least three competing interpretations, scores each one on three independent evidence axes, and explains when—and why—the ranking changes.

The project was built for the LEC AI Engineering Intern build assessment. The committed demo deliberately works without an API key or installed model so reviewers can reproduce every result.

## What it demonstrates

- Three genuinely competing interpretations of the same task.
- Separate semantic, constraint-consistency, and historical-pattern scores.
- A later message that reverses an earlier constraint and changes the winner.
- Message-level evidence for every decision.
- Relative confidence with explicit human-review thresholds.
- An ambiguous example where the agent refuses to guess.
- User-selectable weight profiles without hiding contradictory evidence.
- A provider boundary for deterministic fixtures, Codex CLI, and Codex with Ollama.

## Run locally

Requirements:

- Node.js 20 or newer.
- pnpm 10 or newer.

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Next.js, normally [http://localhost:3000](http://localhost:3000).

No environment variables or model credentials are required for the walkthrough.

## Analyze your own conversation

Select **Analyze a log** in the header. Paste a conversation or choose/drop a
`.json`, `.csv`, or `.txt` file, review the message preview, choose an available
provider, then start analysis. The workbench replaces the walkthrough with the
returned ranking and labels the provider that produced the candidates. Later
follow-up messages send the entire updated log through the same `/api/rank`
pipeline; they do not reuse a walkthrough candidate catalogue.

Two ready-to-download examples are included:

- [Finance reframe JSON](public/samples/finance-reframe.json)
- [Weekly ambiguity CSV](public/samples/weekly-ambiguity.csv)

### Canonical conversation format

Every import is normalised to this Zod-validated contract. Array order is the
source of truth and message IDs are retained for evidence references.

```json
{
  "conversationId": "finance-handoff-42",
  "userId": "maya-chen",
  "domain": {
    "name": "retail-analytics",
    "metadata": { "region": "UK", "priority": 2 }
  },
  "messages": [
    {
      "id": "source-message-17",
      "text": "Send the raw rows as CSV.",
      "timestamp": "2026-08-14T09:19:00.000Z"
    },
    {
      "id": "source-message-18",
      "text": "Understood.",
      "timestamp": "2026-08-14T09:19:10.000Z"
    }
  ],
  "acceptedOutcomes": [
    {
      "id": "accepted-9",
      "title": "Finance CSV export",
      "summary": "Finance previously accepted row-level data as CSV.",
      "semanticTerms": ["finance", "raw rows", "CSV"]
    }
  ]
}
```

`conversationId`, `userId`, and at least one message are required. Each message
requires a unique source ID, usable text, and an ISO-8601 timestamp. `domain` and
`acceptedOutcomes` are optional. Empty logs, whitespace-only messages, duplicate
IDs, and invalid timestamps are rejected before provider execution. The ranker
uses every ordered message as task context; it does not require or infer a
User/Assistant exchange.

JSON may also be a top-level message array using `text` or the common `content`
alias. In that shorthand, missing IDs and timestamps receive stable order-based
values. Existing `author` or `role` fields are tolerated as optional source
metadata, but are not required or used for scoring. CSV requires only a `text`
column; `id`, `timestamp`, and `author` are optional:

```csv
id,text,timestamp
M1,"Send rows, not slides",2026-08-14T09:19:00.000Z
M2,Understood,2026-08-14T09:19:10.000Z
```

TXT uses one non-empty line per message. Prefix a line with any unique source ID
and a colon to retain that ID; unprefixed lines receive stable `M1`, `M2`, … IDs:

```text
request-17: Prepare the June report with row-level detail.
finance-reframe: Send the raw rows instead.
No slides.
```

## Run the checks

```bash
pnpm test
pnpm lint
pnpm build
```

The build script selects Next.js's supported webpack compiler so production
verification also works in restricted CI environments where Turbopack workers
cannot bind a local coordination port.

The tests assert the assessment's central behaviours:

1. The review-deck interpretation wins before the reframe.
2. The finance-ready CSV moves from third to first afterward.
3. The earlier review constraint is recorded as superseded.
4. The weekly-pulse example triggers human review.
5. A custom weighting policy changes the computed totals.
6. The workbench renders three candidates and exposes selection state accessibly.
7. Processing the contradictory message visibly shifts CSV from third to first.

## Three-minute walkthrough

1. Start on **Finance reframe** with messages M1–M2 visible. Point out the three independent scores and the review deck at rank one.
2. Click **Process next message**. M3 says “not a review,” “no slides,” and “raw rows.” Show CSV moving from #3 to #1 and open the reframe evidence.
3. Open **Weights** and choose a preset. Explain that ranking influence is adjustable, while conflicts and uncertainty remain guarded.
4. Switch to **Weekly ambiguity**. Show the 51% / 44% split, the human-review state, and the generated clarification question.
5. Open provider settings briefly to show the local-first adapter boundary.

## How scoring works

Each candidate receives values in `[0, 1]` for:

| Axis | Meaning | Default weight |
| --- | --- | ---: |
| Semantic similarity | Recency-weighted phrase and token alignment with the conversation | 30% |
| Constraint consistency | Agreement with active required/forbidden feature tags | 50% |
| Historical pattern | Similarity to previously accepted tasks for that user/domain | 20% |

The weighted score is:

```text
total = semantic × w_semantic
      + constraints × w_constraints
      + history × w_history
```

Totals are transformed into **relative confidence** with softmax. The UI explicitly does not claim this is a calibrated probability of user intent.

The agent requests human review when:

- No interpretation's weighted evidence clears `0.52`.
- The leader has less than `55%` relative confidence.
- The top two candidates are fewer than `12` percentage points apart.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the detailed design and trade-offs.

## Reframing and contradiction handling

Constraint rules have a dimension, value, mode, and strength. For example:

```json
{
  "dimension": "format",
  "value": "slides",
  "mode": "forbid",
  "strength": 1,
  "phrase": "no slides"
}
```

The ranker keeps one canonical active value for every populated constraint
dimension. A later required value replaces the earlier value in that dimension,
so `format:slides` can become `format:csv` without needing an artificial
`forbid slides` rule. A later prohibition also replaces an earlier requirement
for the same value.

This logic is not tied to output formats or transition words. A semantic
provider returns source-grounded `taskBoundaries` when any message replaces the
preceding task wholesale, even if it simply changes from one unrelated topic to
another. At that boundary the ranker supersedes every earlier active dimension
before applying the new task's arbitrary provider-defined dimensions and
values. A cue-free boundary is retained only when that message contains a
grounded required `topic` or `task` constraint. This prevents an underspecified
format or audience change from erasing the established subject.
Semantic and historical matching use only messages from the current task, so
replaced-task language cannot continue supporting an obsolete interpretation.
For example, the same path handles database diagnostics becoming an
employee-onboarding email; the ranker itself has no database or onboarding
vocabulary. Explicit reset phrases remain a deterministic fallback when no
semantic boundary is available.

Provider constraint labels must also share meaningful language with their
quoted source phrase. Unsupported claims inferred from omission are discarded,
so “Make slides for management” can replace CSV and release-system constraints
without inventing “no migration coverage” or clearing the migration subject.

Every superseded constraint stays in the audit trail with its original source
message and exact matched phrase. Reframe events contain the complete old and
replacement constraints. Quoted or reported instructions are not treated as
new commands, and a positive rule is suppressed when its phrase occurs inside
an explicit negation such as `no slides`.

For every conversation after its first message, the previous turn is recomputed
and returned beside the current result. Follow-up requests include the prior
normalized candidate catalogue, so movement is compared with the interpretations
the user actually saw even when a provider replaces the catalogue for a new
task. Newly introduced or removed candidates are explained without inventing
prior ranks. Each matching candidate includes its previous
semantic, constraint, history, total, confidence, and rank values; signed deltas;
the source message for material changes; added, removed, and unchanged evidence;
and a grounded explanation. `rankingChange` names both winners, explains why a
winner changed, or records that the same interpretation remained first.
`mostInfluentialAxis` records the normalised weight and policy rationale. The
workbench exposes the same deltas and evidence comparison returned by
`POST /api/rank`.

## Local model providers

The committed scenarios use the deterministic provider. This is intentional: a reviewer should not need one of my accounts or tools to run the assessment.

The unified endpoint accepts a canonical log and returns the complete ranking:

```bash
curl -X POST http://localhost:3000/api/rank \
  -H 'content-type: application/json' \
  -d '{
    "provider": "codex",
    "conversation": {
      "conversationId": "example-1",
      "userId": "reviewer",
      "messages": [{
        "id": "M1",
        "text": "No slides; finance needs raw rows as CSV.",
        "timestamp": "2026-08-14T09:19:00.000Z"
      }]
    }
  }'
```

For fully local inference, use `"provider": "codex-oss"` with Ollama installed. The adapter:

- Passes conversation content through stdin rather than shell interpolation.
- Runs in an isolated temporary directory with a read-only sandbox.
- Ignores user configuration and rule files so configured tools and hooks are not loaded.
- Passes only allowlisted runtime paths to the child process, not application secrets.
- Requests a JSON Schema-constrained result.
- Validates the returned structure with Zod.
- Removes its temporary schema directory after each run.

Both provider routes explicitly use the Node.js runtime because they inspect or
launch local executables. They are intended for a trusted local installation,
not as public unauthenticated endpoints.

### Provider API shapes

`GET /api/providers` returns availability without credential material:

```json
{
  "providers": [
    {
      "id": "demo",
      "name": "Deterministic demo",
      "available": true,
      "localInference": true,
      "detail": "No account or network required"
    }
  ]
}
```

`POST /api/rank` accepts `demo`, `codex`, or `codex-oss`, a canonical
`conversation`, optional three-axis `weights`, and an optional `previousInput`
from the preceding response when ranking a follow-up. Success returns the producing
provider, the normalized `RankingInput`, and a complete `RankingResult`. The UI
uses that normalized input to apply later weight changes locally without calling
the provider again. Errors use
`{ "error": { "code", "message", "issues"? } }`: invalid logs return `400`, an
unavailable selected provider returns `503`, and provider execution or output
failures return a redacted `502`. CLI execution has a 120-second timeout and one
safe retry for transient failures. The older `/api/analyse` extraction-only
route remains available for adapter diagnostics.

The result's contradiction and movement fields are:

```text
activeConstraints[]                  one current value per populated dimension
input.taskBoundaries[]                source-grounded whole-task replacements
reframes[]                           exact old/replacement constraints and source IDs
latestReframe?                       only set when the newest message caused one
ranking[].previous                   prior axis scores, total, confidence, and rank
ranking[].deltas                     signed axis/total/confidence/rank changes
ranking[].change                     causal message plus changed/unchanged evidence
ranking[].explanation                explanation for that candidate's complete rank
rankingChange                        previous/current winners and movement explanation
mostInfluentialAxis                  dominant normalised weight and policy rationale
```

The app never reads or exposes saved CLI credentials. Provider discovery checks
executable versions only, and analysis failures do not reflect raw CLI stderr to
HTTP callers. The implementation follows the official [Codex non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

## Project structure

```text
src/
├── app/
│   ├── api/analyse/route.ts       # Optional structured CLI extraction
│   ├── api/providers/route.ts     # Safe local availability checks
│   ├── api/rank/route.ts          # Canonical end-to-end ranking endpoint
│   ├── layout.tsx                 # Static document shell and font variables
│   └── page.tsx                   # Workbench entry point
├── components/
│   ├── intent-ranker.tsx          # Workbench composition boundary
│   ├── intent-ranker/             # Workflow hook, panels, dialogs, and display helpers
│   ├── intent-ranker.test.tsx     # Browser-like interaction regressions
│   └── ui/                        # Requested shadcn preset components
└── lib/
    ├── conversations/             # Canonical schema and import parsers
    ├── providers/
    │   ├── command.ts             # Isolated non-interactive CLI arguments
    │   ├── codex-exec.ts          # Codex / Ollama adapter
    │   ├── demo.ts                # Credential-free arbitrary-log fallback
    │   ├── environment.ts         # Subprocess environment allowlist
    │   ├── normalize.ts           # Grounding, keys, features, deduplication
    │   └── types.ts               # Provider-neutral contract
    └── ranking/
        ├── engine.ts              # Ranking orchestration and cross-run comparison
        ├── constraints.ts         # Ordered constraints and task-switch handling
        ├── scoring.ts             # Snapshot signal and confidence scoring
        ├── explanations.ts        # Candidate and winner-change explanations
        ├── engine.test.ts         # Behavioural tests
        ├── scenarios.ts           # Inspectable demo fixtures and rules
        └── types.ts               # Domain model
```

## Development workflow

Behavioural changes follow red–green–refactor: add a public-behaviour test,
confirm it fails for the intended reason, implement the smallest fix, and keep
the suite green while refactoring. Before handing work off, run `pnpm test`,
`pnpm lint`, and `pnpm build`.

## Design decisions

### Why deterministic demo data?

The assessment should remain runnable in a logged-out or offline environment. The rules and historic examples are visible in source, while the actual ranking, rank movement, explanations, and uncertainty decisions are calculated at runtime.

### Why not let an LLM produce the final explanation?

The explanation is assembled from stored evidence and computed scores. This prevents a fluent model response from claiming a signal that the ranking code never used.

### Why editable weights but fixed axes?

Different domains value current constraints and established habits differently. Users can tune influence, but cannot remove a required assessment axis or make a contradiction disappear. All values are normalised at scoring time and the active profile is visible.

### Why a web app instead of Electron or Tauri?

The local Next.js server can safely invoke installed CLI adapters while retaining one-command setup. Desktop packaging would add signing, platform dependencies, and sidecar management without improving the ranking evidence shown in this assessment.

## What I would do next

- Add a small labelled evaluation set and calibrate confidence thresholds against it.
- Replace lexical demo similarity with a local embedding model while retaining message-level evidence.
- Persist per-user task history in SQLite with accepted/corrected outcomes.
- Add a human-feedback action that records the accepted interpretation for future history scoring.
- Extend the labelled evaluation set with multiple simultaneous-task cases.
- Package the local-first app with Tauri only if native background monitoring becomes a real requirement.

## Known limitations

- Relative confidence is not statistically calibrated.
- The zero-setup semantic scorer is lexical and will miss some synonyms.
- The credential-free arbitrary-log fallback compares three transparent output
  forms; Codex or Codex with Ollama produces more task-specific candidates.
- User history is represented by a small committed dataset rather than persistent storage.

These limitations are deliberate scope choices rather than hidden production claims.
