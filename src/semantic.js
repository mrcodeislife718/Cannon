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
  global.define('print', { kind: 'builtin', variadic: true });

  function predeclareFunctions(body, scope) {
    for (const statement of body) {
      if (statement.type === 'FunctionDeclaration') {
        scope.define(statement.name, { kind: 'function', arity: statement.params.length, node: statement });
      }
    }
  }

  function analyzeBody(body, scope, functionDepth) {
    predeclareFunctions(body, scope);
    for (const statement of body) analyzeStatement(statement, scope, functionDepth);
  }

  function analyzeStatement(node, scope, functionDepth) {
    switch (node.type) {
      case 'VariableDeclaration':
        analyzeExpression(node.value, scope);
        scope.define(node.name, { kind: node.kind === 'const' ? 'const' : 'variable' });
        return;
      case 'AssignmentStatement':
        analyzeAssignment(node.target, node.value, scope);
        return;
      case 'ExpressionStatement':
        analyzeExpression(node.expression, scope);
        return;
      case 'ReturnStatement':
        if (functionDepth === 0) throw new CannonSemanticError('return can only be used inside a function');
        if (node.value) analyzeExpression(node.value, scope);
        return;
      case 'FunctionDeclaration': {
        const fnScope = new Scope(scope);
        const seen = new Set();
        for (const param of node.params) {
          if (seen.has(param)) throw new CannonSemanticError(`Duplicate parameter ${param} in function ${node.name}`);
          seen.add(param);
          fnScope.define(param, { kind: 'parameter' });
        }
        analyzeBody(node.body.body, fnScope, functionDepth + 1);
        return;
      }
      case 'IfStatement': {
        analyzeExpression(node.test, scope);
        const thenScope = new Scope(scope);
        analyzeBody(node.consequent.body, thenScope, functionDepth);
        if (node.alternate) {
          if (node.alternate.type === 'IfStatement') analyzeStatement(node.alternate, new Scope(scope), functionDepth);
          else analyzeBody(node.alternate.body, new Scope(scope), functionDepth);
        }
        return;
      }
      case 'WhileStatement':
        analyzeExpression(node.test, scope);
        analyzeBody(node.body.body, new Scope(scope), functionDepth);
        return;
      case 'BlockStatement':
        analyzeBody(node.body, new Scope(scope), functionDepth);
        return;
      default:
        throw new CannonSemanticError(`Unsupported statement during analysis: ${node.type}`);
    }
  }

  function analyzeAssignment(target, value, scope) {
    analyzeExpression(value, scope);
    if (target.type === 'Identifier') {
      const existing = scope.resolve(target.name);
      if (existing?.kind === 'const') throw new CannonSemanticError(`Cannot reassign const binding: ${target.name}`);
      if (!existing) scope.define(target.name, { kind: 'variable', implicit: true });
      return;
    }
    if (target.type === 'MemberExpression') {
      analyzeExpression(target.object, scope);
      if (target.computed) analyzeExpression(target.property, scope);
      return;
    }
    throw new CannonSemanticError('Invalid assignment target');
  }

  function analyzeExpression(node, scope) {
    switch (node.type) {
      case 'Literal': return;
      case 'Identifier':
        if (!scope.resolve(node.name)) throw new CannonSemanticError(`Undefined identifier: ${node.name}`);
        return;
      case 'ArrayExpression':
        for (const element of node.elements) analyzeExpression(element, scope);
        return;
      case 'ObjectExpression':
        for (const property of node.properties) analyzeExpression(property.value, scope);
        return;
      case 'MemberExpression':
        analyzeExpression(node.object, scope);
        if (node.computed) analyzeExpression(node.property, scope);
        return;
      case 'UnaryExpression':
        analyzeExpression(node.argument, scope);
        return;
      case 'BinaryExpression':
        analyzeExpression(node.left, scope);
        analyzeExpression(node.right, scope);
        return;
      case 'CallExpression': {
        analyzeExpression(node.callee, scope);
        for (const arg of node.arguments) analyzeExpression(arg, scope);
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

  analyzeBody(ast.body, global, 0);
  return ast;
}
