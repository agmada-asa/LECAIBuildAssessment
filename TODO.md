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
- [x] Handle unavailable Codex and OpenAI-compatible API providers honestly.
- [x] Retain deterministic sample mode as a clearly labelled fallback.
- [x] Add tests for malformed, duplicated, and contradictory provider output.

### Audit-found open-set ranking failures

- [x] Replace the deterministic provider's fixed `structured data`,
  `presentation`, and `dashboard` catalogue with candidates grounded in the
  imported conversation, or refuse analysis when grounded candidate generation
  is unavailable.
- [x] Add a browser-level regression for the `dentist appointment -> flights ->
  apology email` conversation and assert that all three interpretations concern
  plausible tasks from that conversation.
- [x] Add a regression for `No CSV, no slides, no dashboard. Write the apology
  email` and ensure none of the forbidden formats receives positive constraint
  or semantic evidence.
- [x] Add a candidate-validity or `none of the above` gate before confidence is
  calculated so a closed set of unrelated candidates cannot produce a
  `Decision ready` result.
- [x] Prevent negated words from increasing feature-hash or lexical similarity
  for the interpretation they explicitly prohibit.
- [x] Use message roles or authors when supplied so assistant or system text is
  not scored as a new user instruction; document the intentional fallback for
  role-less logs.

## P0: General contradiction and reframe handling

- [x] Represent the active value for every constraint dimension.
- [x] Supersede an earlier constraint when a later message changes the value,
  not only when `require` changes to `forbid` for the same value.
- [x] Handle `slides -> CSV`.
- [x] Handle `no slides -> PowerPoint after all`.
- [x] Handle `client review -> finance ingestion`.
- [x] Handle a complete switch to an unrelated task.
- [x] Handle paraphrased reversals.
- [x] Handle explicit negation without triggering positive substring rules.
- [x] Distinguish quoted or repeated instructions from new user instructions.
- [x] Record the exact old and replacement constraints.
- [x] Associate every change with its source message.
- [x] Stop describing an old reframe as the latest change after unrelated later
  messages.
- [x] Add a regression test for every contradiction case.

## P0: Explain how and why the ranking changed

- [x] Preserve previous scores for every candidate and scoring axis.
- [x] Return semantic, constraint, history, total, confidence, and rank deltas.
- [x] Explain which message caused each material score change.
- [x] Show the previous and current winner.
- [x] Explain why the previous winner fell.
- [x] Explain why the new winner rose.
- [x] Clearly distinguish changed evidence from unchanged evidence.
- [x] Include score deltas in both the API response and the UI.
- [x] Explain the ranking of all candidates, not only the winner.
- [x] Name the most influential axis and explain why it received that weight.
- [x] Show both supporting and conflicting evidence.

## P0: Finance follow-up ranking regressions

- [x] Add the six-message finance conversation as a regression fixture and
  assert that asking about MCP for the deferred dashboard does not replace the
  active rate-limiting proposal.
- [x] Add the seven-message follow-up as a regression fixture and assert that
  `No MCP now, just get the proposal done` resolves the MCP question, preserves
  the dashboard deferral, and resumes the proposal.
- [x] Represent follow-up questions, temporary deferrals, resumptions, and full
  task replacements as distinct conversation-state transitions.
- [x] Prevent a question about deferred work from superseding the current
  deliverable unless the message explicitly changes the requested scope.
- [x] Ensure provider-generated candidates are mutually exclusive decisions,
  not differently worded versions of the same deliverable.
- [x] Merge semantically equivalent candidates such as `proposal only` and
  `combined concise implementation proposal` before scoring confidence.
- [x] Reject and regenerate provider output that pads the catalogue to three
  candidates with paraphrases; never manufacture ambiguity to satisfy the
  candidate-count contract.
- [x] Preserve genuinely different interpretations when their canonical
  features conflict, even if their wording is similar.
- [x] Treat `No dashboard yet` and `No MCP now` as support for a proposal-only
  candidate and as conflicts only for candidates that actually require the
  prohibited work.
- [x] Validate that every displayed support or conflict badge agrees with the
  constraint mode and the candidate's canonical feature value.
- [x] Calculate confidence and the top-two margin only after equivalent
  candidates have been consolidated.
- [x] Ask a clarification question only when the leading candidates encode a
  genuine unresolved product decision; do not ask users to distinguish
  paraphrases.
- [x] Assert that the seven-message conversation is decision-ready with one
  concise implementation proposal as the winner and no MCP or dashboard work
  in scope.

## P0: Real conversational task queue

- [x] Add a queue view and API that can hold and inspect multiple conversational
  tasks instead of exposing only one in-memory workbench conversation.
- [x] Enqueue new conversations and appended messages with a durable lifecycle
  from `pending` through processing, human review, completion, or failure.
- [x] Add a monitor or worker that resumes queued tasks when context changes and
  reranks only the affected conversation idempotently.
- [x] Surface genuinely uncertain tasks in a human-review queue with the ranked
  alternatives, confidence, evidence, and proposed clarification question.
- [x] Add integration tests for multiple queued tasks, concurrent updates,
  retries, restart recovery, and isolation between users.

## P1: Embedding-based semantic scoring

- [x] Introduce an `EmbeddingProvider` interface.
- [x] Select one embedding model and record its name and version.
- [x] Use the same model for messages, candidates, and historical outcomes.
- [x] Embed each candidate interpretation.
- [x] Embed each relevant user message.
- [x] Calculate cosine similarity for the semantic axis.
- [x] Apply documented recency weighting across messages.
- [x] Retain lexical matching as an inspectable fallback or hybrid component.
- [x] Store the closest matching message as semantic evidence.
- [x] Cache embeddings to avoid unnecessary recomputation.
- [x] Test paraphrases such as `slides`, `deck`, `PowerPoint`, and
  `presentation`.
- [x] Document model latency, privacy, and offline limitations.

## P1: Production-grade semantic embeddings

### Model selection and runtime

- [ ] Benchmark trained semantic embedding models against the labelled Resolve
  evaluation set and record the accuracy, latency, cost, privacy, licensing,
  and deployment trade-offs.
- [ ] Select and pin a production model, revision, vector dimensions, and input
  limits from those results rather than choosing by anecdote.
- [ ] Use the selected trained model for live analysis instead of
  `resolve-local-feature-hash`.
- [x] Keep `resolve-local-feature-hash` only as an explicitly labelled
  deterministic demo/test provider; never present it as a production semantic
  model.
- [x] Decide whether production inference is local or API-backed and make the
  choice explicit in configuration, provider discovery, and the UI.
- [x] Fail clearly when the selected production model is unavailable or
  misconfigured; do not silently fall back to a lower-quality model.
- [x] Batch requests within the selected model's limits and handle timeouts,
  rate limits, malformed responses, dimension mismatches, and retries without
  exposing credentials or conversation text.
- [x] Record the actual model name, immutable revision, dimensions, and provider
  on every ranking run.

### Embedding lifecycle and retrieval

- [x] Namespace in-memory and persisted embedding caches by provider, model,
  revision, dimensions, and normalized input.
- [x] Add an explicit migration/re-embedding path for stored candidate and
  accepted-outcome vectors whenever the production model changes.
- [x] Prevent cosine comparison between vectors produced by different models or
  revisions.
- [x] Use the same production model and input construction for messages,
  candidates, accepted outcomes, and historical retrieval.
- [x] Define truncation or chunking behavior for conversations that exceed the
  model's input limit and retain the source-message provenance of each match.
- [x] Review retention, regional processing, and data-sharing implications for
  conversation text before enabling a hosted embedding provider.
- [x] Measure cache hit rate, embedding latency, request volume, and failures
  without logging raw text, credentials, or vectors containing sensitive data.

### Ranking integration

- [x] Add a provider-neutral semantic de-duplication stage that uses the
  production embeddings alongside canonical feature conflicts and lexical
  checks.
- [x] Evaluate candidate and conversation input templates so similarity reflects
  the requested task rather than repeated tool names such as `MCP`.
- [x] Keep explicit negation, deferral, supersession, and resumption decisions in
  structured constraint logic; do not expect cosine similarity to infer task
  state on its own.
- [x] Ensure negated terms cannot become positive semantic evidence merely
  because the candidate and message share a token.
- [x] Expose enough semantic evidence to distinguish the embedding contribution
  from lexical overlap and constraint scoring.
- [ ] Add an ablation view or evaluation report comparing lexical-only, current
  feature-hash, and trained-model results before changing signal weights.

### Evaluation and rollout

- [x] Extend the labelled evaluation set with deferred-work questions,
  resumptions, negated tool choices, semantically duplicate candidates, and
  proposal-versus-report wording.
- [ ] Measure top-one accuracy, duplicate-candidate rate, false human-review
  rate, constraint-evidence correctness, and historical retrieval quality for
  each model candidate.
- [x] Add deterministic provider-contract tests with mocked trained embeddings
  and a separately runnable integration evaluation against the pinned real
  model.
- [ ] Establish acceptance thresholds and compare the new model with the current
  baseline before rollout.
- [ ] Recalibrate semantic weight, softmax temperature, and human-review
  thresholds only after candidate correctness and model selection are fixed.
- [x] Roll out behind explicit configuration, compare results in shadow mode,
  and document rollback criteria.
- [x] Update `.env.example`, setup documentation, architecture notes, and known
  limitations with the selected model and operational requirements.

## P1: Local SQLite state and historical retrieval

### Database structure

- [x] Add durable schema initialization for conversations, ranking runs, task
  outcomes, and queued conversation revisions.
- [x] Store model-tagged vectors locally and calculate cosine similarity in
  process for the assessment-sized dataset.
- [x] Add appropriate relational lookup and lifecycle indexes.
- [x] Add `created_at` and `updated_at` fields where operationally useful.
- [x] Seed reproducible walkthrough history.

### Conversation and queue state

- [x] Persist imported conversations and ordered messages.
- [x] Persist each ranking run and the last processed message.
- [x] Add conversation states:
  - `pending`.
  - `processing`.
  - `human_review`.
  - `decided`.
  - `failed`.
- [x] Add idempotency so retrying a ranking job does not duplicate outcomes.
- [x] Surface processing and failure states in the UI.

### Historical pattern matching

- [x] Store embeddings for accepted and corrected task outcomes.
- [x] Retrieve the most similar accepted outcomes for the current conversation.
- [x] Filter retrieval by user and domain where applicable.
- [x] Return historical similarity and provenance to the scorer.
- [x] Remove the requirement that history IDs already match generated candidate
  IDs exactly.
- [x] Add an `Accept interpretation` action.
- [x] Add a `Correct interpretation` action.
- [x] Save accepted and corrected outcomes for future ranking runs.
- [x] Test retrieval with users who have different domain patterns.

### Audit-found feedback, identity, and persistence failures

- [x] Make `Correct interpretation` collect or select the actual intended task;
  do not submit the currently selected candidate with only a `corrected` label.
- [x] Persist a corrected selection as rejected evidence for the wrong candidate
  and accepted evidence only for the supplied correction; never map both
  feedback decisions to `accepted: true` during retrieval.
- [x] Separate the browser/device owner id from the canonical conversation
  `userId`, and scope history retrieval to the imported user and domain.
- [x] Define safe behavior for logs without a domain so they cannot retrieve all
  unrelated outcomes previously recorded in the same browser.
- [x] Add a regression proving an apology-email task cannot receive an 86%+
  history score from unrelated structured-data outcomes.
- [x] Make `Reset` clear or archive the durable latest run as well as React state,
  or rename it to describe the narrower behavior; verify that a reload does not
  unexpectedly restore a reset result.
- [x] Restore the actual analysis provider, imported user id, domain, and user
  role from persistence instead of labelling a restored Codex result as a
  deterministic fixture or replacing imported identity with a device UUID.
- [x] Either connect the documented Supabase, pgvector, and RLS path to the
  running app or rename and document the actual local persistence backend; do
  not present unexercised infrastructure as shipped behavior.

### Security and configuration

- [x] Keep the local database behind server routes and scope every read/write by
  the browser owner before applying imported-user and domain filters.
- [x] Test that users cannot retrieve another user's conversational history.
- [x] Keep provider credentials on the server only.
- [x] Add documented placeholders to `.env.example`.
- [x] Confirm no real credentials appear in source, logs, fixtures, screenshots,
  or Git history.

## P1: Confidence, ambiguity, and clarification

- [x] Keep confidence explicitly labelled as relative until calibrated.
- [x] Generate clarification questions from the actual disagreement between the
  top two interpretations.
- [x] Remove the hardcoded dashboard-versus-report clarification question.
- [x] Return a machine-readable human-review reason.
- [x] Ensure unrelated topic switches cannot remain `Decision ready` using stale
  candidates.
- [x] Test weak evidence, close candidates, and low-total-score cases
  independently.
- [x] Document the reason for each weight and threshold.

## P1: Evaluation dataset and calibration

- [x] Create a labelled evaluation set of at least 20 realistic conversational
  logs.
- [x] Include clear intent cases.
- [x] Include genuinely ambiguous cases.
- [x] Include late contradictions.
- [x] Include gradual reframing.
- [x] Include synonyms and paraphrases.
- [x] Include unrelated topic replacement.
- [x] Include weak-evidence cases.
- [x] Include misleading or quoted source messages.
- [x] Include negated and quoted instructions.
- [x] Record the expected winner and human-review decision for each case.
- [x] Measure top-one ranking accuracy.
- [x] Measure whether ambiguous cases are correctly escalated.
- [x] Use the results to justify confidence thresholds and softmax temperature.
- [x] Publish the evaluation method and results in the README.

### Audit-found evaluation gaps

- [x] Label the current 22-case result as a scorer evaluation because its
  hand-authored candidate catalogues bypass live candidate generation.
- [x] Add provider-inclusive evaluation that starts with raw conversational logs
  and measures candidate grounding, distinctness, ranking accuracy, confidence,
  and escalation end to end.
- [x] Add open-set cases where no generated candidate is correct, arbitrary
  domain switches, explicit format negation, role-bearing messages, deferred
  work questions, resumptions, and history contamination attempts.
- [x] Add browser tests for the audited arbitrary-log and rate-limit conversations
  so a passing unit suite cannot hide failures in the shipped provider path.

## P1: Automated verification

- [x] Add unit tests for semantic scoring.
- [x] Add unit tests for constraint scoring.
- [x] Add unit tests for historical scoring.
- [x] Add constraint extraction and supersession tests.
- [x] Add embedding-provider contract tests.
- [x] Add file-import parser tests.
- [x] Add `/api/rank` route tests.
- [x] Add provider error and timeout tests.
- [x] Add SQLite repository tests.
- [x] Add history retrieval and isolation tests.
- [x] Add confidence and abstention boundary tests.
- [x] Add UI tests for imports, failures, uncertainty, and score deltas.
- [x] Add at least one browser-level end-to-end walkthrough test.
- [x] Run the narrowest relevant checks during development.
- [x] Before completion, pass `pnpm test`.
- [x] Before completion, pass `pnpm lint`.
- [x] Before completion, pass `pnpm build`.

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
- [ ] Distinguish `configured` from `operational` provider status: verify
  readiness with a bounded health check instead of showing green availability
  merely because environment variables exist.
- [ ] Clear or visibly mark an old ranking as stale when a provider attempt
  fails, and disable accept/correct actions until the current run succeeds.
- [ ] Name the active semantic model in the UI; do not label the local token and
  bigram feature hash only as `Semantic` in a way that implies trained
  embeddings.

## P2: Imported-log and responsive UX audit

- [ ] Remove fixture-only scenario controls and fixture role metadata after an
  arbitrary log is imported, or clearly separate samples from the active log.
- [ ] Warn before switching a scenario discards an imported conversation or its
  unsaved analysis.
- [ ] Preserve the scenario or conversation title at a 390 px viewport instead
  of leaving only unlabeled previous/next chevrons.
- [ ] Keep the ranking and review state reachable without scrolling through an
  entire long transcript; consider a collapsed transcript or result-first
  mobile layout.
- [ ] Raise dense 9-11 px evidence and metadata text to a readable minimum and
  verify zoom, reflow, keyboard navigation, focus visibility, and contrast.
- [ ] Do not display synthetic year-2000 timestamps for TXT messages that had no
  timestamp; show message order or label the time as unavailable.

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
- [ ] Confirm the public default branch contains the exact audited submission
  commit, rather than an older build while current work remains only local.

### Video and final links

- [ ] Record a walkthrough no longer than three minutes that runs an arbitrary
  log, shows a contradiction-driven ranking shift, explains the three scoring
  axes, and honestly calls out unfinished behavior.
- [ ] Upload the video with link access enabled and verify it to the three-minute
  mark in a logged-out browser window.
- [ ] Add the public repository and video URLs to the submission response, then
  open both from a logged-out browser before sending it.
