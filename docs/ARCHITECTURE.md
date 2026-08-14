# Architecture

This document explains the system boundaries and the reasoning behind them. It complements the code comments rather than duplicating implementation details line by line.

## Data flow

```text
Conversation messages
        │
        ├── candidate interpretations (3+)
        ├── active and superseded constraints
        └── accepted historical tasks
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

The application—not the model—owns conversational state. A ranking run receives the full processed message list, the candidate catalogue, active policy weights, and user history. It also recomputes the immediately previous turn so movement can be explained accurately.

This makes the demo reproducible and prevents provider session memory from becoming an undocumented fourth signal.

## Rendering boundary

The root layout remains a Next.js Server Component and owns only metadata,
document structure, and self-hosted font variables. The workbench is the client
boundary because it needs state and event handlers. Its tooltip provider is
mounted inside that boundary rather than around the entire document, keeping
static layout code out of the client module graph.

Inter is the body font. Geist is limited to headings and monospace values via
separate `next/font` CSS variables, avoiding external browser font requests.

## Semantic score

The zero-setup implementation uses inspectable phrases and token overlap:

1. Candidate terms are matched against every processed message.
2. Older message matches decay by `0.76 ^ age`.
3. Negated phrases such as “no slides” do not count as semantic support for slides.
4. The four strongest term matches are combined with title/summary token overlap.

This is intentionally simpler than production embeddings, but it is deterministic and testable. A local embedding implementation can replace this scorer without changing the ranker contract.

## Constraint score

Each extracted constraint contains:

- A message and matched phrase.
- A canonical dimension and value.
- `require` or `forbid` mode.
- Strength from `0` to `1`.

Candidates expose canonical features such as `format:slides` and `granularity:raw`. Exact required features score `1`; direct conflicts score near `0`; unspecified features remain neutral rather than being treated as false.

When a later message flips the same dimension/value pair, the old constraint is marked superseded. This preserves auditability while giving the latest explicit instruction precedence.

## Historical score

Historical examples are accepted outcomes, not merely earlier chat messages. The scorer compares the current conversation with tasks previously resolved to the same canonical interpretation. This keeps historical pattern matching distinct from current-conversation semantic similarity.

## Confidence and abstention

Weighted evidence scores are converted to relative confidence with softmax at temperature `0.17`. This makes the ordering legible but does not establish empirical calibration.

The abstention layer looks at evidence sufficiency, leader confidence, and the leader/runner-up margin. It is deliberately separate from candidate generation, so any provider must obey the same human-review policy.

## User-controlled weights

Weights are normalised before use, which prevents accidental totals above or below 100 from corrupting the calculation. The three assessment axes cannot be disabled in the UI; sliders retain a minimum contribution.

Weight changes affect ranking influence, not the underlying evidence. Conflict badges and human-review checks remain visible under every profile.

## Provider boundary

`ProviderAnalysis` is intentionally narrow:

- Three to five mutually exclusive interpretations.
- Semantic terms for each interpretation.
- Canonical candidate features.
- Extracted constraints grounded in conversation phrases.

Providers do not choose the winner. This prevents Codex, Claude, Ollama, or another future adapter from silently replacing the application's scoring policy.

The Codex adapter uses `spawn` with an argument array and stdin. It never builds
a shell command from user content. Live extraction runs from the temporary
schema directory rather than the repository, uses a read-only sandbox, and
ignores user configuration and rule files so configured MCP servers and hooks
are not loaded. The child process receives an allowlist of runtime paths instead
of the parent server's full environment. JSON Schema constrains the response and
Zod validates it before it crosses the provider boundary. Raw provider errors
remain server-side and are represented by a redacted `502` response.

## Explanation boundary

The decision brief is a template over:

- Current and previous winners.
- Active policy weights.
- Strongest computed signal.
- Recorded reframe events.
- Uncertainty reason.

It does not reveal or request hidden model reasoning. Reviewers can trace every sentence to stored values in the output model.

## Testing strategy

Domain tests cover invariant behaviours rather than exact floating-point
snapshots, including cue-free reframes and invalid weight policies. Provider
tests cover subprocess isolation and redacted HTTP errors. JSDOM component tests
cover the initial candidate list, heading hierarchy, accessible selection state,
optional provider discovery, and the contradictory-message rank shift.

Manual browser and computer-use checks cover:

- Initial ranking visibility.
- Processing the contradictory third message.
- Visible rank movement and reframe evidence.
- Ambiguous scenario and clarification prompt.
- Ranking-policy preset controls.
- Local provider discovery.

The production build performs the final TypeScript and route compilation check.
