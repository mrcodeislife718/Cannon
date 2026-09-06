export class CannonSemanticError extends Error {
  constructor(message) { super(message); this.name = 'CannonSemanticError'; }
}

class Scope {
  constructor(parent = null) { this.parent = parent; this.symbols = new Map(); }
  define(name, symbol) { if (this.symbols.has(name)) throw new CannonSemanticError(`Duplicate binding: ${name}`); this.symbols.set(name, symbol); return symbol; }
  resolve(name) { if (this.symbols.has(name)) return this.symbols.get(name); return this.parent?.resolve(name) ?? null; }
}

export function analyze(ast) {
  const global = new Scope();
  global.define('print', { kind: 'builtin', variadic: true, async: false });
  const exported = new Set();

  function functionSymbol(candidate) {
    const defaultCount = Object.keys(candidate.defaults ?? {}).length;
    return {
      kind: 'function',
      requiredArity: candidate.params.length - defaultCount,
      maximumArity: candidate.restParam ? Infinity : candidate.params.length,
      variadic: Boolean(candidate.restParam),
      async: Boolean(candidate.async),
      node: candidate,
    };
  }

  function predeclareFunctions(body, scope) {
    for (const statement of body) {
      const candidate = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
      if (candidate?.type === 'FunctionDeclaration') scope.define(candidate.name, functionSymbol(candidate));
    }
  }

  function analyzeBody(body, scope, context) {
    predeclareFunctions(body, scope);
    for (const statement of body) analyzeStatement(statement, scope, context);
  }

  function analyzeStatement(node, scope, context) {
    switch (node.type) {
      case 'ImportDeclaration':
        for (const specifier of node.specifiers) scope.define(specifier.local, { kind: 'import', source: node.source, imported: specifier.imported ?? (specifier.type === 'ImportDefaultSpecifier' ? 'default' : '*') });
        return;
      case 'ExportNamedDeclaration':
        if (node.declaration) { analyzeStatement(node.declaration, scope, context); if (node.declaration.name) exported.add(node.declaration.name); return; }
        for (const specifier of node.specifiers) { if (!node.source && !scope.resolve(specifier.local)) throw new CannonSemanticError(`Cannot export undefined binding: ${specifier.local}`); exported.add(specifier.exported); }
        return;
      case 'ExportDefaultDeclaration':
        if (node.declaration.type === 'FunctionDeclaration') analyzeStatement(node.declaration, scope, context); else analyzeExpression(node.declaration, scope, context);
        exported.add('default'); return;
      case 'VariableDeclaration': analyzeExpression(node.value, scope, context); scope.define(node.name, { kind: node.kind === 'const' ? 'const' : 'variable', dynamic: node.kind !== 'const' }); return;
      case 'AssignmentStatement': analyzeAssignment(node.target, node.value, scope, context); return;
      case 'ExpressionStatement': analyzeExpression(node.expression, scope, context); return;
      case 'ReturnStatement':
        if (context.functionDepth === 0) throw new CannonSemanticError('return can only be used inside a function');
        if (node.value) analyzeExpression(node.value, scope, context);
        return;
      case 'RaiseStatement':
        if (node.value) analyzeExpression(node.value, scope, context);
        else if (context.catchDepth === 0) throw new CannonSemanticError('bare raise can only be used inside catch');
        return;
      case 'TryStatement': {
        analyzeBody(node.body.body, new Scope(scope), context);
        if (node.handler) {
          const catchScope = new Scope(scope);
          if (node.handler.param) catchScope.define(node.handler.param, { kind: 'catch', dynamic: true });
          analyzeBody(node.handler.body.body, catchScope, { ...context, catchDepth: context.catchDepth + 1 });
        }
        if (node.finalizer) analyzeBody(node.finalizer.body, new Scope(scope), context);
        return;
      }
      case 'BreakStatement': if (context.loopDepth === 0) throw new CannonSemanticError('break can only be used inside a loop'); return;
      case 'ContinueStatement': if (context.loopDepth === 0) throw new CannonSemanticError('continue can only be used inside a loop'); return;
      case 'FunctionDeclaration': {
        const fnScope = new Scope(scope), seen = new Set();
        for (const param of node.params) {
          if (seen.has(param)) throw new CannonSemanticError(`Duplicate parameter ${param} in function ${node.name}`);
          seen.add(param);
          if (node.defaults?.[param]) analyzeExpression(node.defaults[param], fnScope, context);
          fnScope.define(param, { kind: 'parameter', dynamic: true, defaulted: Boolean(node.defaults?.[param]) });
        }
        if (node.restParam) {
          if (seen.has(node.restParam)) throw new CannonSemanticError(`Duplicate parameter ${node.restParam} in function ${node.name}`);
          fnScope.define(node.restParam, { kind: 'parameter', dynamic: true, variadic: true });
        }
        analyzeBody(node.body.body, fnScope, { functionDepth: context.functionDepth + 1, loopDepth: 0, catchDepth: 0, async: Boolean(node.async), functionName: node.name });
        return;
      }
      case 'IfStatement':
        analyzeExpression(node.test, scope, context);
        analyzeBody(node.consequent.body, new Scope(scope), context);
        if (node.alternate) node.alternate.type === 'IfStatement' ? analyzeStatement(node.alternate, new Scope(scope), context) : analyzeBody(node.alternate.body, new Scope(scope), context);
        return;
      case 'WhileStatement':
        analyzeExpression(node.test, scope, context);
        analyzeBody(node.body.body, new Scope(scope), { ...context, loopDepth: context.loopDepth + 1 });
        return;
      case 'ForStatement': {
        const loopScope = new Scope(scope);
        if (node.init) analyzeStatement(node.init, loopScope, context);
        if (node.test) analyzeExpression(node.test, loopScope, context);
        if (node.update) analyzeStatement(node.update, loopScope, { ...context, loopDepth: context.loopDepth + 1 });
        analyzeBody(node.body.body, loopScope, { ...context, loopDepth: context.loopDepth + 1 });
        return;
      }
      case 'ForInStatement': {
        analyzeExpression(node.iterable, scope, context);
        const loopScope = new Scope(scope);
        loopScope.define(node.binding, { kind: 'variable', dynamic: true, iterationBinding: true });
        analyzeBody(node.body.body, loopScope, { ...context, loopDepth: context.loopDepth + 1 });
        return;
      }
      case 'BlockStatement': analyzeBody(node.body, new Scope(scope), context); return;
      default: throw new CannonSemanticError(`Unsupported statement during analysis: ${node.type}`);
    }
  }

  function analyzeAssignment(target, value, scope, context) {
    analyzeExpression(value, scope, context);
    if (target.type === 'Identifier') {
      const existing = scope.resolve(target.name);
      if (existing?.kind === 'const' || existing?.kind === 'import') throw new CannonSemanticError(`Cannot reassign ${existing.kind} binding: ${target.name}`);
      if (!existing) scope.define(target.name, { kind: 'variable', implicit: true, dynamic: true });
      return;
    }
    if (target.type === 'MemberExpression') { analyzeExpression(target.object, scope, context); if (target.computed) analyzeExpression(target.property, scope, context); return; }
    throw new CannonSemanticError('Invalid assignment target');
  }

  function analyzeExpression(node, scope, context) {
    switch (node.type) {
      case 'Literal': return;
      case 'Identifier': if (!scope.resolve(node.name)) throw new CannonSemanticError(`Undefined identifier: ${node.name}`); return;
      case 'ArrayExpression': for (const element of node.elements) analyzeExpression(element, scope, context); return;
      case 'ObjectExpression': for (const property of node.properties) analyzeExpression(property.value, scope, context); return;
      case 'MemberExpression': analyzeExpression(node.object, scope, context); if (node.computed) analyzeExpression(node.property, scope, context); return;
      case 'UnaryExpression': analyzeExpression(node.argument, scope, context); return;
      case 'AwaitExpression': if (!context.async) throw new CannonSemanticError('await can only be used inside an async function'); analyzeExpression(node.argument, scope, context); return;
      case 'BinaryExpression': analyzeExpression(node.left, scope, context); analyzeExpression(node.right, scope, context); return;
      case 'CallExpression': {
        analyzeExpression(node.callee, scope, context);
        for (const arg of node.arguments) analyzeExpression(arg, scope, context);
        if (node.callee.type === 'Identifier') {
          const symbol = scope.resolve(node.callee.name);
          if (symbol?.kind === 'function') {
            const count = node.arguments.length;
            if (count < symbol.requiredArity || count > symbol.maximumArity) {
              const expected = symbol.variadic ? `at least ${symbol.requiredArity}` : symbol.requiredArity === symbol.maximumArity ? `${symbol.requiredArity}` : `${symbol.requiredArity}-${symbol.maximumArity}`;
              throw new CannonSemanticError(`${node.callee.name} expects ${expected} arguments, received ${count}`);
            }
          }
        }
        return;
      }
      default: throw new CannonSemanticError(`Unsupported expression during analysis: ${node.type}`);
    }
  }

  analyzeBody(ast.body, global, { functionDepth: 0, loopDepth: 0, catchDepth: 0, async: false, functionName: null });
  ast.exports = [...exported].sort();
  return ast;
}
