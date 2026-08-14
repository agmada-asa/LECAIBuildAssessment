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

## Run the checks

```bash
pnpm test
pnpm lint
pnpm build
```

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

When a later message reverses the same dimension/value pair, the earlier constraint remains in the audit trail but is marked `superseded`. Only the active constraint contributes to the current score. The previous turn is recomputed, allowing rank movement to be derived rather than hard-coded.

## Local model providers

The committed scenarios use the deterministic provider. This is intentional: a reviewer should not need one of my accounts or tools to run the assessment.

An optional Next.js route exposes live candidate extraction through an installed Codex CLI:

```bash
curl -X POST http://localhost:3000/api/analyse \
  -H 'content-type: application/json' \
  -d '{
    "provider": "codex",
    "conversation": "User: Package June performance like the client review. User: No slides; finance needs raw rows."
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

`POST /api/analyse` accepts a `provider` of `codex` or `codex-oss` and a
conversation between 10 and 20,000 characters. Success returns
`{ "analysis": ProviderAnalysis }`. Invalid input returns `{ "error": string }`
with status `400`; unavailable executables and invalid provider output return a
redacted error with status `502`.

The app never reads or exposes saved CLI credentials. Provider discovery checks
executable versions only, and analysis failures do not reflect raw CLI stderr to
HTTP callers. The implementation follows the official [Codex non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

## Project structure

```text
src/
├── app/
│   ├── api/analyse/route.ts       # Optional structured CLI extraction
│   ├── api/providers/route.ts     # Safe local availability checks
│   ├── layout.tsx                 # Static document shell and font variables
│   └── page.tsx                   # Workbench entry point
├── components/
│   ├── intent-ranker.tsx          # Interactive three-column UI
│   ├── intent-ranker.test.tsx     # Browser-like interaction regressions
│   └── ui/                        # Requested shadcn preset components
└── lib/
    ├── providers/
    │   ├── command.ts             # Isolated non-interactive CLI arguments
    │   ├── codex-exec.ts          # Codex / Ollama adapter
    │   ├── environment.ts         # Subprocess environment allowlist
    │   └── types.ts               # Provider-neutral contract
    └── ranking/
        ├── engine.ts              # Scoring, ranking, confidence, abstention
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
- Connect the live provider output to the UI's candidate editor.
- Add a human-feedback action that records the accepted interpretation for future history scoring.
- Add adversarial tests for negation, quoted instructions, topic switches, and multiple simultaneous tasks.
- Package the local-first app with Tauri only if native background monitoring becomes a real requirement.

## Known limitations

- Relative confidence is not statistically calibrated.
- The zero-setup semantic scorer is lexical and will miss some synonyms.
- Demo candidate generation uses transparent fixtures; live CLI extraction is exposed by API but not required by the walkthrough.
- User history is represented by a small committed dataset rather than persistent storage.

These limitations are deliberate scope choices rather than hidden production claims.
