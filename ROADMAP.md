# Cannon Roadmap

Cannon is the original general-purpose `.cannon` programming language.

## Product contract

Cannon prioritizes Python-level learnability, JavaScript-like freedom and async ergonomics, C-level capability when needed, and Rust-inspired safety without forcing systems complexity on every developer. The core language keeps a deliberately small keyword set and relies on Nova inference rather than annotation ceremony.

## Language direction

- Human-readable syntax and minimal punctuation.
- Inference-first variables, parameters, return types, collections, nullability, and effects.
- Automatic memory management in ordinary Cannon.
- Web, backend, application, AI, and general-purpose programming as first-class targets.
- `cannon app.cannon` as the obvious execution path.
- `cannon add`, `cannon test`, `cannon fmt`, and `cannon check` integrated rather than fragmented across many tools.
- Cannon+ remains the official strict/systems superset rather than bloating Cannon itself.

## Proof gates

Syntax is supported only after lexer/parser/semantic/execution tests pass. A platform target is supported only after real programs build and run on it. Performance claims require reproducible benchmarks.

## Commercial boundary

Cannon itself is adoption infrastructure. Monetization should primarily happen through Syncio, Chronos, Cortex, Velocity cloud services, Plasma Enterprise, support, and enterprise platform offerings rather than charging developers simply to use the language.
