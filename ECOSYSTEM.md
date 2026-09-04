# Cannon ecosystem role

Cannon is the general-purpose programming-language foundation of the Cannon developer ecosystem.

## Intent

Cannon is intended to combine approachable, expressive ideas associated with languages such as Python, Ruby and Perl with the control and systems reach associated with C, without simply cloning any one language. The governing principles are: easy things stay easy, powerful things remain possible, and dangerous things are explicit.

## Ownership boundary

Cannon owns the language syntax, semantics and ordinary developer-facing programming model. Cannon should not absorb every adjacent concern into the language itself.

- Cannon+ owns the strict typed/systems superset.
- Nova owns compiler intelligence, inference, diagnostics, IR, optimization and backend generation.
- Parallel owns runtime services and execution.
- Plasma owns interoperability with foreign languages, runtimes and native APIs.
- Cadence owns backend/web application composition.
- Sprout owns UI components and reactivity.
- Velocity owns universal application workflow and target orchestration.
- Chronos owns remote build, release, deployment and update infrastructure.
- Scout is the non-executable JSON-compatible structured-data/configuration format.
- Cortex is the integrated AI-native development environment over the ecosystem.

## Ecosystem path

Cannon / Cannon+ -> Nova -> Parallel -> applications
                         |        |
                         |        +-> Cadence / Sprout
                         +-> Plasma interoperability

Velocity composes the application-development workflow. Chronos turns source into reproducible, signed, deployable releases. Cortex provides the integrated engineering surface. Scout remains usable both inside and outside Cannon projects.

## Repository rule

Keep Cannon independently versioned, tested and releasable with explicit contracts to sibling repositories. Do not collapse the ecosystem into a monorepo or claim sibling capabilities as Cannon features until integration is executable and verified.
