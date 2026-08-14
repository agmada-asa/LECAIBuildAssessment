# LEC AI Build Assessment TODO

This checklist tracks the work required to turn Resolve from a deterministic
demonstrator into an end-to-end agent that satisfies the build brief. Work is
ordered by assessment value: make arbitrary conversational logs work first,
then strengthen retrieval, contradiction handling, evaluation, and submission
readiness.

## Definition of done

The project is ready when a reviewer can supply a conversational log and see
the same pipeline:

1. Retrieve or generate at least three genuinely competing interpretations.
2. Score each interpretation independently for semantic similarity, constraint
   consistency, and historical patterns.
3. Rank the interpretations with clearly labelled confidence scores.
4. Explain the complete ranking using grounded evidence from the conversation
   and accepted task history.
5. Show how a later contradiction changed individual signals and ranks.
6. Request human review when evidence is weak or interpretations are genuinely
   ambiguous.

## Existing foundations

- [x] Rank three interpretations in the deterministic scenarios.
- [x] Calculate semantic, constraint, and historical scores separately.
- [x] Apply explicit, configurable scoring weights.
- [x] Produce relative confidence scores.
- [x] Abstain when evidence is weak or candidates are close.
- [x] Preserve superseded constraints for auditability.
- [x] Demonstrate a realistic multi-turn contradiction.
- [x] Provide an intentionally ambiguous scenario.
- [x] Validate live provider output with Zod.
- [x] Pass user content to local providers without shell interpolation.
- [x] Pass the existing tests, lint, and production build.
- [x] Document current limitations.

## P0: End-to-end arbitrary log analysis

### Canonical conversation format

- [x] Define a Zod-validated `ConversationLog` contract containing:
  - Conversation ID.
  - User ID and optional domain metadata.
  - Ordered messages.
  - Message source ID, text, and timestamp.
  - Optional previously accepted outcomes.
- [x] Reject empty logs and messages without usable text.
- [x] Preserve message order and source-message IDs throughout the pipeline.
- [x] Treat every ordered message as task context without requiring speaker roles.
- [x] Document the canonical format with examples.

### CSV, JSON, and TXT imports

- [x] Add file-picker and drag-and-drop controls.
- [x] Allow a conversational log to be pasted directly.
- [x] Parse JSON message arrays.
- [x] Parse CSV files with documented column names.
- [x] Parse one TXT message per line with optional arbitrary source IDs.
- [x] Normalise all formats into `ConversationLog`.
- [x] Show a message preview before analysis.
- [x] Display actionable validation errors.
- [x] Include downloadable sample files for both walkthrough scenarios.
- [x] Add parser tests for valid, incomplete, and malformed files.

### Unified ranking API

- [x] Add `POST /api/rank`.
- [x] Accept the canonical conversational log.
- [x] Generate or retrieve three to five competing interpretations.
- [x] Extract grounded constraints with source-message references.
- [x] Retrieve relevant accepted historical outcomes.
- [x] Calculate all three scoring axes.
- [x] Apply confidence and human-review policy.
- [x] Return a complete `RankingResult`.
- [x] Return structured errors for invalid input and provider failures.
- [x] Add safe provider timeouts and retry behavior where appropriate.
- [x] Connect the main UI to `/api/rank`.
- [x] Ensure custom messages rerun the complete pipeline instead of reusing the
  fixture candidate catalogue.
- [x] Add API integration tests.

### Provider-to-ranker integration

- [x] Convert `ProviderAnalysis` into the ranker's canonical input.
- [x] Remove the production ranking path's dependency on a preconstructed
  `Scenario`.
- [x] Generate stable canonical candidate keys where possible.
- [x] Validate candidate feature tags against constraint dimensions.
- [x] Reject or merge duplicate and substantially overlapping candidates.
- [x] Require at least three genuinely distinct interpretations.
- [x] Allow the user to select an available provider.
- [x] Clearly show which provider produced an analysis.
- [x] Handle unavailable Codex and Ollama providers honestly.
- [x] Retain deterministic sample mode as a clearly labelled fallback.
- [x] Add tests for malformed, duplicated, and contradictory provider output.

## P0: General contradiction and reframe handling

- [ ] Represent the active value for every constraint dimension.
- [ ] Supersede an earlier constraint when a later message changes the value,
  not only when `require` changes to `forbid` for the same value.
- [ ] Handle `slides -> CSV`.
- [ ] Handle `no slides -> PowerPoint after all`.
- [ ] Handle `client review -> finance ingestion`.
- [ ] Handle a complete switch to an unrelated task.
- [ ] Handle paraphrased reversals.
- [ ] Handle explicit negation without triggering positive substring rules.
- [ ] Distinguish quoted or repeated instructions from new user instructions.
- [ ] Record the exact old and replacement constraints.
- [ ] Associate every change with its source message.
- [ ] Stop describing an old reframe as the latest change after unrelated later
  messages.
- [ ] Add a regression test for every contradiction case.

## P0: Explain how and why the ranking changed

- [ ] Preserve previous scores for every candidate and scoring axis.
- [ ] Return semantic, constraint, history, total, confidence, and rank deltas.
- [ ] Explain which message caused each material score change.
- [ ] Show the previous and current winner.
- [ ] Explain why the previous winner fell.
- [ ] Explain why the new winner rose.
- [ ] Clearly distinguish changed evidence from unchanged evidence.
- [ ] Include score deltas in both the API response and the UI.
- [ ] Explain the ranking of all candidates, not only the winner.
- [ ] Name the most influential axis and explain why it received that weight.
- [ ] Show both supporting and conflicting evidence.

## P1: Embedding-based semantic scoring

- [ ] Introduce an `EmbeddingProvider` interface.
- [ ] Select one embedding model and record its name and version.
- [ ] Use the same model for messages, candidates, and historical outcomes.
- [ ] Embed each candidate interpretation.
- [ ] Embed each relevant user message.
- [ ] Calculate cosine similarity for the semantic axis.
- [ ] Apply documented recency weighting across messages.
- [ ] Retain lexical matching as an inspectable fallback or hybrid component.
- [ ] Store the closest matching message as semantic evidence.
- [ ] Cache embeddings to avoid unnecessary recomputation.
- [ ] Test paraphrases such as `slides`, `deck`, `PowerPoint`, and
  `presentation`.
- [ ] Document model latency, privacy, and offline limitations.

## P1: Supabase state and historical retrieval

### Database structure

- [ ] Add versioned migrations for:
  - `conversations`.
  - `messages`.
  - `interpretations`.
  - `ranking_runs`.
  - `interpretation_scores`.
  - `constraints`.
  - `task_outcomes`.
- [ ] Enable `pgvector`.
- [ ] Add appropriate relational and vector indexes.
- [ ] Add `created_at` and `updated_at` fields where operationally useful.
- [ ] Seed reproducible walkthrough history.

### Conversation and queue state

- [ ] Persist imported conversations and ordered messages.
- [ ] Persist each ranking run and the last processed message.
- [ ] Add conversation states:
  - `pending`.
  - `processing`.
  - `human_review`.
  - `decided`.
  - `failed`.
- [ ] Add idempotency so retrying a ranking job does not duplicate outcomes.
- [ ] Surface processing and failure states in the UI.

### Historical pattern matching

- [ ] Store embeddings for accepted and corrected task outcomes.
- [ ] Retrieve the most similar accepted outcomes for the current conversation.
- [ ] Filter retrieval by user and domain where applicable.
- [ ] Return historical similarity and provenance to the scorer.
- [ ] Remove the requirement that history IDs already match generated candidate
  IDs exactly.
- [ ] Add an `Accept interpretation` action.
- [ ] Add a `Correct interpretation` action.
- [ ] Save accepted and corrected outcomes for future ranking runs.
- [ ] Test retrieval with users who have different domain patterns.

### Security and configuration

- [ ] Enable Row Level Security on exposed tables.
- [ ] Test that users cannot retrieve another user's conversational history.
- [ ] Keep service-role credentials on the server only.
- [ ] Add documented placeholders to `.env.example`.
- [ ] Confirm no real credentials appear in source, logs, fixtures, screenshots,
  or Git history.

## P1: Confidence, ambiguity, and clarification

- [ ] Keep confidence explicitly labelled as relative until calibrated.
- [ ] Generate clarification questions from the actual disagreement between the
  top two interpretations.
- [ ] Remove the hardcoded dashboard-versus-report clarification question.
- [ ] Return a machine-readable human-review reason.
- [ ] Ensure unrelated topic switches cannot remain `Decision ready` using stale
  candidates.
- [ ] Test weak evidence, close candidates, and low-total-score cases
  independently.
- [ ] Document the reason for each weight and threshold.

## P1: Evaluation dataset and calibration

- [ ] Create a labelled evaluation set of at least 20 realistic conversational
  logs.
- [ ] Include clear intent cases.
- [ ] Include genuinely ambiguous cases.
- [ ] Include late contradictions.
- [ ] Include gradual reframing.
- [ ] Include synonyms and paraphrases.
- [ ] Include unrelated topic replacement.
- [ ] Include weak-evidence cases.
- [ ] Include misleading or quoted source messages.
- [ ] Include negated and quoted instructions.
- [ ] Record the expected winner and human-review decision for each case.
- [ ] Measure top-one ranking accuracy.
- [ ] Measure whether ambiguous cases are correctly escalated.
- [ ] Use the results to justify confidence thresholds and softmax temperature.
- [ ] Publish the evaluation method and results in the README.

## P1: Automated verification

- [ ] Add unit tests for semantic scoring.
- [ ] Add unit tests for constraint scoring.
- [ ] Add unit tests for historical scoring.
- [ ] Add constraint extraction and supersession tests.
- [ ] Add embedding-provider contract tests.
- [ ] Add file-import parser tests.
- [ ] Add `/api/rank` route tests.
- [ ] Add provider error and timeout tests.
- [ ] Add Supabase repository tests.
- [ ] Add history retrieval and isolation tests.
- [ ] Add confidence and abstention boundary tests.
- [ ] Add UI tests for imports, failures, uncertainty, and score deltas.
- [ ] Add at least one browser-level end-to-end walkthrough test.
- [ ] Run the narrowest relevant checks during development.
- [ ] Before completion, pass `pnpm test`.
- [ ] Before completion, pass `pnpm lint`.
- [ ] Before completion, pass `pnpm build`.

## P2: Remove demo-only behavior

- [ ] Remove the artificial processing delay.
- [ ] Only use `Live analysis` when the real pipeline is running.
- [ ] Replace scenario-specific UI text with data-driven copy.
- [ ] Make provider controls operational rather than informational.
- [ ] Split the large workbench component into focused components and hooks.
- [ ] Add proper loading, empty, error, retry, and unavailable-provider states.
- [ ] Clearly label deterministic sample mode.
- [ ] Make arbitrary log analysis the primary screen.
- [ ] Keep the curated scenarios as reproducible sample inputs, not a separate
  scoring implementation.

## Documentation

- [ ] Rewrite the README opening around what actually works.
- [ ] Document the complete log-to-ranking data flow.
- [x] Document CSV, JSON, and TXT import formats.
- [ ] Document Supabase setup and migrations.
- [ ] Document every environment variable.
- [ ] Document embedding model selection and fallback behavior.
- [ ] Explain scoring weights and uncertainty thresholds.
- [ ] Include evaluation results.
- [ ] Clearly separate deterministic sample mode from live analysis.
- [ ] Update the architecture documentation and diagrams.
- [ ] Add clean-install and production-run instructions.
- [ ] Keep an honest `Known limitations` section.
- [ ] Explain what would be built next with more time.

## Submission readiness

### Repository

- [ ] Create focused commits using Conventional Commit messages.
- [ ] Inspect every staged diff for secrets and sensitive data.
- [ ] Push the project to a public GitHub repository.
- [ ] Add a license if appropriate.
- [ ] Confirm the repository opens in a logged-out browser.
- [ ] Clone the public repository into a clean directory.
- [ ] Confirm the documented setup works from the clean clone.
- [ ] Run `pnpm test`, `pnpm lint`, and `pnpm build` from the clean clone.
