export class CannonSemanticError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CannonSemanticError';
  }
}

class Scope {
  constructor(parent = null) {
    this.parent = parent;
    this.symbols = new Map();
  }
  define(name, symbol) {
    if (this.symbols.has(name)) throw new CannonSemanticError(`Duplicate binding: ${name}`);
    this.symbols.set(name, symbol);
    return symbol;
  }
  resolve(name) {
    if (this.symbols.has(name)) return this.symbols.get(name);
    return this.parent?.resolve(name) ?? null;
  }
}

export function analyze(ast) {
  const global = new Scope();
  global.define('print', { kind: 'builtin', variadic: true, async: false });

  function predeclareFunctions(body, scope) {
    for (const statement of body) {
      if (statement.type === 'FunctionDeclaration') {
        scope.define(statement.name, { kind: 'function', arity: statement.params.length, async: Boolean(statement.async), node: statement });
      }
    }
  }

  function analyzeBody(body, scope, context) {
    predeclareFunctions(body, scope);
    for (const statement of body) analyzeStatement(statement, scope, context);
  }

  function analyzeStatement(node, scope, context) {
    switch (node.type) {
      case 'VariableDeclaration':
        analyzeExpression(node.value, scope, context);
        scope.define(node.name, { kind: node.kind === 'const' ? 'const' : 'variable' });
        return;
      case 'AssignmentStatement':
        analyzeAssignment(node.target, node.value, scope, context);
        return;
      case 'ExpressionStatement':
        analyzeExpression(node.expression, scope, context);
        return;
      case 'ReturnStatement':
        if (context.functionDepth === 0) throw new CannonSemanticError('return can only be used inside a function');
        if (node.value) analyzeExpression(node.value, scope, context);
        return;
      case 'FunctionDeclaration': {
        const fnScope = new Scope(scope);
        const seen = new Set();
        for (const param of node.params) {
          if (seen.has(param)) throw new CannonSemanticError(`Duplicate parameter ${param} in function ${node.name}`);
          seen.add(param);
          fnScope.define(param, { kind: 'parameter' });
        }
        analyzeBody(node.body.body, fnScope, { functionDepth: context.functionDepth + 1, async: Boolean(node.async), functionName: node.name });
        return;
      }
      case 'IfStatement': {
        analyzeExpression(node.test, scope, context);
        analyzeBody(node.consequent.body, new Scope(scope), context);
        if (node.alternate) {
          if (node.alternate.type === 'IfStatement') analyzeStatement(node.alternate, new Scope(scope), context);
          else analyzeBody(node.alternate.body, new Scope(scope), context);
        }
        return;
      }
      case 'WhileStatement':
        analyzeExpression(node.test, scope, context);
        analyzeBody(node.body.body, new Scope(scope), context);
        return;
      case 'BlockStatement':
        analyzeBody(node.body, new Scope(scope), context);
        return;
      default:
        throw new CannonSemanticError(`Unsupported statement during analysis: ${node.type}`);
    }
  }

  function analyzeAssignment(target, value, scope, context) {
    analyzeExpression(value, scope, context);
    if (target.type === 'Identifier') {
      const existing = scope.resolve(target.name);
      if (existing?.kind === 'const') throw new CannonSemanticError(`Cannot reassign const binding: ${target.name}`);
      if (!existing) scope.define(target.name, { kind: 'variable', implicit: true });
      return;
    }
    if (target.type === 'MemberExpression') {
      analyzeExpression(target.object, scope, context);
      if (target.computed) analyzeExpression(target.property, scope, context);
      return;
    }
    throw new CannonSemanticError('Invalid assignment target');
  }

  function analyzeExpression(node, scope, context) {
    switch (node.type) {
      case 'Literal': return;
      case 'Identifier':
        if (!scope.resolve(node.name)) throw new CannonSemanticError(`Undefined identifier: ${node.name}`);
        return;
      case 'ArrayExpression':
        for (const element of node.elements) analyzeExpression(element, scope, context);
        return;
      case 'ObjectExpression':
        for (const property of node.properties) analyzeExpression(property.value, scope, context);
        return;
      case 'MemberExpression':
        analyzeExpression(node.object, scope, context);
        if (node.computed) analyzeExpression(node.property, scope, context);
        return;
      case 'UnaryExpression':
        analyzeExpression(node.argument, scope, context);
        return;
      case 'AwaitExpression':
        if (!context.async) throw new CannonSemanticError('await can only be used inside an async function');
        analyzeExpression(node.argument, scope, context);
        return;
      case 'BinaryExpression':
        analyzeExpression(node.left, scope, context);
        analyzeExpression(node.right, scope, context);
        return;
      case 'CallExpression': {
        analyzeExpression(node.callee, scope, context);
        for (const arg of node.arguments) analyzeExpression(arg, scope, context);
        if (node.callee.type === 'Identifier') {
          const symbol = scope.resolve(node.callee.name);
          if (symbol?.kind === 'function' && node.arguments.length !== symbol.arity) {
            throw new CannonSemanticError(`${node.callee.name} expects ${symbol.arity} arguments, received ${node.arguments.length}`);
          }
        }
        return;
      }
      default:
        throw new CannonSemanticError(`Unsupported expression during analysis: ${node.type}`);
    }
  }

  analyzeBody(ast.body, global, { functionDepth: 0, async: false, functionName: null });
  return ast;
}
