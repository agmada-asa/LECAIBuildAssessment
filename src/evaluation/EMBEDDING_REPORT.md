# Production embedding evaluation

Measured 14 August 2026 against the committed 22-case scorer dataset.

## Selection

The production runtime is API-only: OpenRouter's OpenAI-compatible embeddings
endpoint with `openai/text-embedding-3-small`, 1,536 dimensions, and an 8,191
token application limit (one token below the advertised 8,192 context window).
The API does not publish an immutable weights revision for this model alias, so
the configured revision records the canonical model slug. Model metadata is
recorded on every run and a changed slug/dimension triggers re-embedding.

## Ablation

| Semantic mode | Top-one accuracy | p95 per-case latency | Deployment |
| --- | ---: | ---: | --- |
| Lexical only | 18/22 (81.8%) | <1 ms | In process |
| `resolve-local-feature-hash@1.0.0` | 22/22 (100%) | <1 ms | Test only |
| `openai/text-embedding-3-small` | 18/22 (81.8%) | 826 ms | Hosted API |

The feature hash is a domain-shaped deterministic test oracle, not a production
model. The trained model clears the 80% absolute gate but does not improve this
small scorer set over lexical overlap. It remains the selected production
semantic runtime because production is API-only and the feature hash is
prohibited outside tests. Candidate generation, constraints, and human review
remain separate safety layers.

The fixed-catalogue set has a 0% duplicate-candidate rate. Constraint badges are
derived from structured constraint/candidate feature agreement, giving 100%
contract correctness by construction; route and normalization regressions test
malformed badges. Historical retrieval has separate model-tagged cosine and
user/domain-isolation tests. The raw-log provider-inclusive suite measures a 0%
false-review rate on its labelled clear cases. These measures have different
denominators and are not presented as one calibrated quality score.

## Cost, privacy, licensing, and operations

- OpenRouter lists the model at $0.02 per million input tokens and an 8K context
  window: https://openrouter.ai/openai/text-embedding-3-small/pricing
- Prompt/response retention is opt-in, while request metadata is retained:
  https://openrouter.ai/docs/guides/privacy/data-collection
- Sensitive deployments should require zero-data-retention routing:
  https://openrouter.ai/docs/guides/features/zdr
- Use is governed by OpenRouter and upstream OpenAI service terms; this is an
  API service, not redistributable local weights.

Run the deterministic ablation with `pnpm test`. Run the credentialed trial with:

```bash
set -a; source .env.local; set +a
EMBEDDING_INTEGRATION=true RUN_TRAINED_EMBEDDING_EVAL=1 \
  pnpm exec vitest run src/evaluation/trained-embedding.integration.test.ts
```

Rollback means selecting a previously approved API model revision and
re-embedding stored vectors. The application never silently falls back to
lexical-only or feature-hash semantics when the API is unavailable.
