# Cannon

Cannon is a general-purpose programming language and the language foundation of the Cannon developer ecosystem. Its design target is simple, dynamic programming with Python-level learnability, expressive application development, and a path to deeper control and performance without forcing systems complexity onto ordinary users.

Cannon is not a DSL and is not defined by its current bootstrap backend. The language is intended to stand on its own.

## Current executable language

```cannon
fn greet(name, punctuation = "!") {
  return "Hello " + name + punctuation
}

items = ["Ada", "Grace", "Linus"]

for name in items {
  print(greet(name))
}
```

Variables are dynamic by default. A value can naturally move between numbers, strings, collections, and objects without required type annotations. Cannon+ remains the strict/systems superset for developers who deliberately want stronger static and systems constraints.

## Run and build

```bash
cannon run main.cannon
cannon build main.cannon -o main.mjs
cannon check main.cannon
cannon ast main.cannon
cannon fmt main.cannon
cannon test
```

## Implemented language surface

The current canonical implementation supports:

- `.cannon` source files
- line and block comments
- numbers, strings, booleans, and null
- arrays and object literals
- property and indexed access
- dynamic variables and reassignment
- `let` and `const`
- first assignment without declaration ceremony
- named functions and direct function calls
- default parameters evaluated fresh per call
- variadic parameters with `...rest`
- `return`
- `if` / `else`
- `while`
- simple iterable loops: `for item in iterable`
- C-style `for (init; test; update)` when explicit control is useful
- `break` and `continue`
- structured exceptions with `raise`, `try`, `catch`, and `finally`
- bare `raise` rethrow inside `catch`
- async functions and `await`
- imports, exports, default exports, namespace imports, and re-exports
- arithmetic, comparison, boolean, and unary operators
- built-in `print(...)`
- source formatting
- semantic validation including scope, const/import reassignment, loop control, async boundaries, catch boundaries, and known-function arity
- multi-file module graph compilation
- dependency manifests, lockfiles, integrity-checked package installation, and registry integration
- reproducible target/build tooling
- crash-safe recovery checkpoints

## Design rules

Cannon follows three rules:

1. Easy things stay easy.
2. Powerful things remain possible.
3. Dangerous things are explicit.

The language should remain dynamic and concise by default. Nova is responsible for deeper compiler inference and optimization. Parallel is responsible for Cannon's runtime path. Cannon+ carries stricter typed/systems semantics. This separation keeps ordinary Cannon code approachable without accepting poor performance or permanent loss of control as unavoidable tradeoffs.

## Performance direction

The current JavaScript backend is a working bootstrap target, not Cannon's permanent performance ceiling. Language features are designed to lower directly where possible rather than requiring an interpreter-style dispatch layer. Examples include direct iterable loops, direct calls, native structured exception lowering, async lowering, and native parameter/default/rest handling.

Performance claims are only made after reproducible benchmarks. Nova and Parallel provide the long-term compiler/runtime optimization path.

## Compiler pipeline today

```text
.cannon source
    ↓
lexer
    ↓
parser
    ↓
semantic analysis
    ↓
Cannon AST / frontend artifact
    ↓
backend lowering
    ↓
current JS target + additional target work
```

Only functionality backed by working code and tests is listed as implemented.

## Developer ecosystem

```text
Scout       structured-data / formatting language
Cannon      general-purpose dynamic programming language
Cannon+     strict/systems superset
Nova        compiler + developer intelligence
Parallel    runtime
Plasma      foreign/native interoperability
Cadence     backend/web framework
Sprout      UI framework
Velocity    universal application-development workflow
Chronos     remote build/release/deploy/update platform
Cortex      AI-native IDE/control surface across the stack
```

Each sibling remains independently useful and owns its own product responsibility. Cannon remains the programming language.

See [VISION.md](./VISION.md), [ROADMAP.md](./ROADMAP.md), and [ECOSYSTEM.md](./ECOSYSTEM.md).

## Test

```bash
npm test
```

The suite compiles and executes Cannon programs and includes semantic, module, async, control-flow, dynamic-language, exception, function-ergonomics, recovery, target, and toolchain coverage.

## License

MIT
