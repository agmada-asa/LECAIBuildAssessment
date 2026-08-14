# Project Working Agreement

These instructions apply to all work in this repository.

## Clarify Before Acting

- If the requested behaviour, scope, acceptance criteria, or intended user experience is unclear, ask concise clarifying questions before making changes.
- Do not silently choose between materially different interpretations.
- State any minor assumptions that do not warrant blocking the work.

## Write Understandable, Self Documenting Code

- Optimise for a reader being able to open any file and quickly understand its purpose, responsibilities, inputs, outputs, and important constraints.
- Add a short file level docstring or documentation comment to source files you create or substantially change.
- Add docstrings or documentation comments to functions, classes, components, hooks, and modules. Document parameters, return values, side effects, errors, and invariants where relevant.
- Comment code as you work. Comments should explain intent, domain rules, trade-offs, and non-obvious decisions rather than restating the syntax.
- Use clear names, small focused units, explicit types, and straightforward control flow. Do not rely on comments to compensate for confusing code.
- Keep the implementation footprint as small as practical. Every abstraction, layer, module, helper, and dependency must solve a concrete problem and earn its place.
- Do not create function wrappers, pass-through helpers, indirection layers, or one-use abstractions merely for structure or the possibility of future reuse. Call the underlying function directly when a wrapper adds no meaningful behaviour, policy, validation, or clarity.
- Prefer the simplest design that satisfies the current requirements. Avoid speculative generalisation, premature abstraction, and configuration that has no present use case.
- Extract reusable code when multiple callers share a stable concept or when doing so materially improves readability, testing, or consistency. Keep reusable APIs narrow, cohesive, and explicit.
- Keep functions, components, and modules small enough to understand and test in isolation, but do not split cohesive logic into fragments that force readers to jump through unnecessary files or layers.
- Optimise for maintainability: minimise coupling, keep responsibilities clear, preserve useful boundaries, remove dead code, and make the likely path for future changes easy to identify.
- When choosing between cleverness and obvious code, prefer the obvious implementation unless measured constraints require otherwise.
- Keep documentation accurate whenever behaviour changes. Update nearby comments, README content, examples, configuration documentation, and environment-variable documentation as part of the same change.
- Record significant architectural or product decisions in `docs/` when a code comment would not provide enough context.

## Product and Interface Style

- Keep interfaces as simple as possible. Every piece of text, control, decoration, and section must earn its place by helping the user understand something or complete a task.
- Do not use eyebrow text, pre-headings, overlines, badges, or labels above headings unless they communicate information the user genuinely needs and that is not already clear from the surrounding context.
- Avoid verbose screens. Prefer a clear hierarchy, concise copy, and a small number of purposeful elements over repeated explanations, excessive cards, decorative sections, or multiple calls to action.
- Remove redundant headings, descriptions, helper text, metadata, and controls. Do not say the same thing in several different ways or add content merely to make a screen feel complete.
- Write all user-facing copy from the user's perspective. Focus on their goal, vocabulary, context, and the information they need to make a decision or take the next step.
- Do not expose the developer's request, implementation language, internal data model, or technical framing in the interface unless that information is genuinely useful to the user.
- Use plain, direct, specific language. Prefer short sentences and familiar words, while retaining enough context to prevent ambiguity or mistakes.
- When requirements prescribe particular text or elements, interpret them in service of the user's needs rather than reproducing development instructions literally. Ask for clarification if that would materially change the intended product behaviour.

## Test Driven Development

- Use a red-green-refactor workflow for behavioural changes:
  1. Write or update a test that describes the desired behaviour and confirm it fails for the expected reason.
  2. Make the smallest implementation change needed to pass the test.
  3. Refactor while keeping the test suite green.
- Every bug fix must include a regression test that fails without the fix.
- Test public behaviour, important edge cases, error paths, and accessibility-relevant interactions. Avoid tests coupled to implementation details unless no stable public boundary exists.
- Do not describe work as complete until the relevant tests have been run successfully.
- Before returning completed work, run the narrowest relevant checks during development and then run the repository completion checks:
  - `pnpm test`
  - `pnpm lint`
  - `pnpm build` for changes that can affect compilation, rendering, routing, configuration, or production behaviour
- If a required check cannot be run or does not pass, do not claim completion. Clearly report the command, result, and blocker.

## Documentation Expectations

- Document all user facing features, setup steps, commands, configuration, environment variables, APIs, data shapes, migrations, and operational considerations affected by a change.
- Include examples when they make expected usage or behaviour clearer.
- Treat documentation and tests as part of the implementation, not optional follow-up work.

## Sensitive Data and Secrets

- Never commit, stage, paste into source files, or otherwise expose sensitive data. This includes passwords, API keys, access tokens, private keys, session credentials, connection strings, personal data, and confidential customer or business information.
- Store local secrets only in ignored environment files or an approved secret management system. Commit documented placeholders in `.env.example`, never real values.
- Before committing, inspect the staged diff and verify that it contains no secrets or sensitive data. Do not assume a file is safe merely because it is normally ignored.
- Avoid printing secrets in logs, test output, screenshots, fixtures, examples, documentation, or error messages. Redact sensitive values when reporting diagnostics.
- If sensitive data is discovered in the working tree or Git history, stop work, do not commit or push it, and tell the user immediately. Treat exposed credentials as compromised and recommend revocation or rotation; deleting the value from a later commit is not sufficient.

## Git Conventions

- Use short lived branches named with a Conventional Commit-style type and a concise kebab-case description, for example:
  - `feat/add-intent-filtering`
  - `fix/handle-empty-ranking-results`
  - `docs/explain-local-setup`
  - `test/add-ranking-regressions`
  - `refactor/simplify-score-normalisation`
  - `chore/update-tooling`
- Use Conventional Commits for commit messages: `<type>(optional-scope): <imperative summary>`.
- Prefer the types `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`, and `revert`.
- Keep commits focused and independently understandable. Include related tests and documentation in the same commit as the behaviour they describe.
- Do not mix unrelated changes into a branch or commit.
