# Production embedding evaluation

Status: **pending credentials and hosted-provider approval**.

No trained-model result is reported yet. The deterministic contract suite mocks
the OpenAI-compatible endpoint; it does not establish semantic quality, latency,
or cost for a real model. Before selecting a production model, run the labelled
Resolve set against each pinned candidate/revision and compare it with both the
lexical-only and `resolve-local-feature-hash@1.0.0` demo baselines.

Record top-one accuracy, duplicate-candidate rate, false human-review rate,
constraint-evidence correctness, historical retrieval quality, p50/p95 latency,
request volume, and estimated cost. Also record provider retention, processing
region, data-sharing terms, model licence, dimensions, and input limits.

The executable release gates live in `embedding-benchmark.ts`. A trained model
must clear every gate before `EMBEDDING_ROLLOUT_MODE=trained`; use `shadow` first
and roll back to the last approved **trained** revision if any quality gate
regresses. The feature hash is a demo/test baseline, not a production rollback.

After filling the pinned OpenAI-compatible environment variables, run the real
model scorer integration separately from the deterministic suite:

```bash
RUN_TRAINED_EMBEDDING_EVAL=1 pnpm exec vitest run src/evaluation/trained-embedding.integration.test.ts
```

Copy the measured result and provider trade-offs into this report before
selecting a production winner or recalibrating ranking policy.
