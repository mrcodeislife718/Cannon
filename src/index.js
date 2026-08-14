export { lex, CannonSyntaxError } from './lexer.js';
export { parse } from './parser.js';
export { compile, emitJavaScript } from './compiler.js';
export { format, check, run, addDependency, install, discoverTests, runTests, createProject, moduleResolver } from './toolchain.js';
export { buildTarget, executeTarget, reproducibleTargetBuild, benchmarkCompiler, emitNativeC } from './targets.js';
