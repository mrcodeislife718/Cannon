# Cannon

Cannon is a general-purpose programming language under active implementation. The repository currently contains a working compiler frontend, JavaScript backend, and CLI for `.cannon` source files.

## Current executable language

```cannon
fn add(a, b) {
  return a + b
}

value = add(7, 5)

if (value == 12) {
  print("Cannon works")
}
```

Run it:

```bash
cannon run main.cannon
```

Compile it:

```bash
cannon build main.cannon -o main.mjs
node main.mjs
```

Validate source:

```bash
cannon check main.cannon
```

Inspect the AST:

```bash
cannon ast main.cannon
```

## Implemented syntax

The current compiler supports:

- `.cannon` source files
- line and block comments
- numbers, strings, booleans, and null
- identifiers
- `let` and `const` declarations
- Python-like first assignment without a declaration keyword
- reassignment
- functions with parameters
- function calls
- `return`
- `if` / `else`
- `while`
- arithmetic operators
- comparison operators
- boolean `&&` / `||`
- unary `!`, `+`, and `-`
- built-in `print(...)`
- JavaScript code generation
- direct execution through Node.js

## Compiler pipeline

```text
.cannon source
    ↓
lexer
    ↓
parser
    ↓
AST
    ↓
JavaScript backend
    ↓
Node.js execution or .mjs output
```

Only executable functionality is listed as implemented. Additional backends, interoperability systems, AI libraries, editor tooling, and platform targets will be added when working code and tests exist for them.

## Philosophy

Cannon is being built around three engineering rules:

1. Easy things stay easy.
2. Powerful things remain possible.
3. Dangerous things are explicit.

Scout (`.scout`) is the companion structured-data format. Cannon is executable code; Scout is non-executable structured data.

## Test

```bash
npm test
```

The test suite compiles and executes Cannon programs rather than only checking static metadata.

## License

MIT
