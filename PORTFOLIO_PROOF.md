# Cannon — Portfolio Proof Contract

**Track:** Programming language / developer infrastructure

Cannon is complete only when defined language semantics execute correctly, deterministically, and compatibly across representative programs with documented performance and failure behavior.

Required proof: parser/type/runtime/compiler tests appropriate to the implementation; conformance corpus; invalid-program/adversarial parser tests; differential or reference comparisons where possible; benchmarks for compile/startup/runtime/memory; security for untrusted code where applicable; packaging/install/deployment; real developer usage if commercialized.

**Next proof target:** establish a versioned language conformance suite containing valid, invalid, edge-case, and regression programs and run it automatically against every supported implementation path.