import { parse } from './parser.js';
import { analyze } from './semantic.js';

function indent(level) { return '  '.repeat(level); }

export function emitJavaScript(ast) {
  const declaredScopes = [new Set()];
  const catchBindings = [];
  let syntheticCatchId = 0;
  const currentScope = () => declaredScopes[declaredScopes.length - 1];
  const isDeclared = (name) => declaredScopes.some((scope) => scope.has(name));

  function emitProgram(node) { return node.body.map((statement) => emitStatement(statement, 0)).join('\n'); }
  function emitBlock(node, level, bindings = []) {
    declaredScopes.push(new Set(bindings));
    const body = node.body.map((statement) => emitStatement(statement, level + 1)).join('\n');
    declaredScopes.pop();
    return `{\n${body}\n${indent(level)}}`;
  }
  function emitForClause(node) {
    if (!node) return '';
    if (node.type === 'VariableDeclaration') { currentScope().add(node.name); return `${node.kind} ${node.name} = ${emitExpression(node.value)}`; }
    if (node.type === 'AssignmentStatement') {
      if (node.target.type === 'Identifier') {
        const firstAssignment = !isDeclared(node.target.name);
        if (firstAssignment) currentScope().add(node.target.name);
        return `${firstAssignment ? 'let ' : ''}${node.target.name} = ${emitExpression(node.value)}`;
      }
      return `${emitExpression(node.target)} = ${emitExpression(node.value)}`;
    }
    if (node.type === 'ExpressionStatement') return emitExpression(node.expression);
    throw new Error(`Unsupported Cannon for-clause statement: ${node.type}`);
  }
  function emitFunctionParameters(node) {
    const parameters = node.params.map((param) => node.defaults?.[param] ? `${param} = ${emitExpression(node.defaults[param])}` : param);
    if (node.restParam) parameters.push(`...${node.restParam}`);
    return parameters.join(', ');
  }
  function emitFunctionExpression(node) {
    const bindings = node.restParam ? [...node.params, node.restParam] : [...node.params];
    declaredScopes.push(new Set(bindings));
    const body = emitBlock(node.body, 0);
    declaredScopes.pop();
    return `(${node.async ? 'async ' : ''}function(${emitFunctionParameters(node)}) ${body})`;
  }
  function emitClassMethod(className, method) {
    const bindings = method.restParam ? [...method.params, method.restParam, 'self'] : [...method.params, 'self'];
    declaredScopes.push(new Set(bindings));
    const inner = method.body.body.map((statement) => emitStatement(statement, 1)).join('\n');
    declaredScopes.pop();
    const body = `{\n  const self = this;${inner ? `\n${inner}` : ''}\n}`;
    return `${className}.prototype.${method.name} = ${method.async ? 'async ' : ''}function(${emitFunctionParameters(method)}) ${body};`;
  }
  function emitClass(node, level) {
    const pad = indent(level);
    currentScope().add(node.name);
    const parent = node.superClass ? emitExpression(node.superClass) : 'Object';
    const lines = [
      `${pad}function ${node.name}(...__cannon_args) {`,
      `${pad}  const self = Object.create(${node.name}.prototype);`,
      `${pad}  const initializer = self.init;`,
      `${pad}  if (typeof initializer === 'function') initializer.apply(self, __cannon_args);`,
      `${pad}  return self;`,
      `${pad}}`,
      `${pad}${node.name}.prototype = Object.create(${parent}.prototype);`,
      `${pad}Object.defineProperty(${node.name}.prototype, 'constructor', { value: ${node.name}, writable: true, configurable: true });`,
    ];
    for (const method of node.methods) lines.push(`${pad}${emitClassMethod(node.name, method)}`);
    return lines.join('\n');
  }
  function emitTry(node, level) {
    const pad = indent(level);
    let output = `${pad}try ${emitBlock(node.body, level)}`;
    if (node.handler) {
      const binding = node.handler.param ?? `__cannon_error_${syntheticCatchId++}`;
      catchBindings.push(binding);
      const body = emitBlock(node.handler.body, level, [binding]);
      catchBindings.pop();
      output += ` catch (${binding}) ${body}`;
    }
    if (node.finalizer) output += ` finally ${emitBlock(node.finalizer, level)}`;
    return output;
  }

  function emitStatement(node, level) {
    const pad = indent(level);
    switch (node.type) {
      case 'ImportDeclaration': return `${pad}${emitImport(node)}`;
      case 'ExportNamedDeclaration': {
        if (node.declaration) {
          if (node.declaration.type === 'ClassDeclaration') return `${emitClass(node.declaration, level)}\n${pad}export { ${node.declaration.name} };`;
          return `${pad}export ${emitStatement(node.declaration, 0).trimStart()}`;
        }
        const names = node.specifiers.map((s) => s.local === s.exported ? s.local : `${s.local} as ${s.exported}`).join(', ');
        return `${pad}export { ${names} }${node.source ? ` from ${JSON.stringify(node.source)}` : ''};`;
      }
      case 'ExportDefaultDeclaration':
        if (node.declaration.type === 'FunctionDeclaration') return `${pad}export default ${emitStatement(node.declaration, 0).trimStart()}`;
        if (node.declaration.type === 'ClassDeclaration') return `${emitClass(node.declaration, level)}\n${pad}export default ${node.declaration.name};`;
        return `${pad}export default ${emitExpression(node.declaration)};`;
      case 'ClassDeclaration': return emitClass(node, level);
      case 'VariableDeclaration': currentScope().add(node.name); return `${pad}${node.kind} ${node.name} = ${emitExpression(node.value)};`;
      case 'AssignmentStatement':
        if (node.target.type === 'Identifier') {
          const firstAssignment = !isDeclared(node.target.name);
          if (firstAssignment) currentScope().add(node.target.name);
          return `${pad}${firstAssignment ? 'let ' : ''}${node.target.name} = ${emitExpression(node.value)};`;
        }
        return `${pad}${emitExpression(node.target)} = ${emitExpression(node.value)};`;
      case 'ExpressionStatement': return `${pad}${emitExpression(node.expression)};`;
      case 'ReturnStatement': return `${pad}return${node.value ? ` ${emitExpression(node.value)}` : ''};`;
      case 'RaiseStatement': {
        if (node.value) return `${pad}throw ${emitExpression(node.value)};`;
        const binding = catchBindings.at(-1);
        if (!binding) throw new Error('Cannon bare raise reached code generation outside catch');
        return `${pad}throw ${binding};`;
      }
      case 'TryStatement': return emitTry(node, level);
      case 'BreakStatement': return `${pad}break;`;
      case 'ContinueStatement': return `${pad}continue;`;
      case 'FunctionDeclaration': {
        currentScope().add(node.name);
        const bindings = node.restParam ? [...node.params, node.restParam] : [...node.params];
        declaredScopes.push(new Set(bindings));
        const body = emitBlock(node.body, level);
        declaredScopes.pop();
        return `${pad}${node.async ? 'async ' : ''}function ${node.name}(${emitFunctionParameters(node)}) ${body}`;
      }
      case 'IfStatement': {
        const consequent = emitBlock(node.consequent, level);
        let result = `${pad}if (${emitExpression(node.test)}) ${consequent}`;
        if (node.alternate) result += node.alternate.type === 'IfStatement' ? ` else ${emitStatement(node.alternate, level).trimStart()}` : ` else ${emitBlock(node.alternate, level)}`;
        return result;
      }
      case 'WhileStatement': return `${pad}while (${emitExpression(node.test)}) ${emitBlock(node.body, level)}`;
      case 'ForStatement': {
        declaredScopes.push(new Set());
        const init = emitForClause(node.init);
        const test = node.test ? emitExpression(node.test) : '';
        const update = emitForClause(node.update);
        const body = emitBlock(node.body, level);
        declaredScopes.pop();
        return `${pad}for (${init}; ${test}; ${update}) ${body}`;
      }
      case 'ForInStatement': {
        declaredScopes.push(new Set([node.binding]));
        const body = emitBlock(node.body, level);
        declaredScopes.pop();
        return `${pad}for (const ${node.binding} of ${emitExpression(node.iterable)}) ${body}`;
      }
      case 'BlockStatement': return `${pad}${emitBlock(node, level)}`;
      default: throw new Error(`Unsupported Cannon statement: ${node.type}`);
    }
  }

  function emitImport(node) {
    if (!node.specifiers.length) return `import ${JSON.stringify(node.source)};`;
    const defaultSpecifier = node.specifiers.find((s) => s.type === 'ImportDefaultSpecifier');
    const namespace = node.specifiers.find((s) => s.type === 'ImportNamespaceSpecifier');
    const named = node.specifiers.filter((s) => s.type === 'ImportSpecifier');
    const parts = [];
    if (defaultSpecifier) parts.push(defaultSpecifier.local);
    if (namespace) parts.push(`* as ${namespace.local}`);
    if (named.length) parts.push(`{ ${named.map((s) => s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`).join(', ')} }`);
    return `import ${parts.join(', ')} from ${JSON.stringify(node.source)};`;
  }

  function emitExpression(node) {
    switch (node.type) {
      case 'Literal': return JSON.stringify(node.value);
      case 'Identifier': return node.name;
      case 'ArrayExpression': return `[${node.elements.map(emitExpression).join(', ')}]`;
      case 'ObjectExpression': return `{ ${node.properties.map((p) => `${JSON.stringify(p.key)}: ${emitExpression(p.value)}`).join(', ')} }`;
      case 'MemberExpression': return node.computed ? `${emitExpression(node.object)}[${emitExpression(node.property)}]` : `${emitExpression(node.object)}.${node.property.name}`;
      case 'UnaryExpression': return `(${node.operator}${emitExpression(node.argument)})`;
      case 'AwaitExpression': return `(await ${emitExpression(node.argument)})`;
      case 'BinaryExpression': {
        const operator = node.operator === '==' ? '===' : node.operator === '!=' ? '!==' : node.operator;
        return `(${emitExpression(node.left)} ${operator} ${emitExpression(node.right)})`;
      }
      case 'FunctionExpression': return emitFunctionExpression(node);
      case 'CallExpression': {
        const callee = node.callee.type === 'Identifier' && node.callee.name === 'print' ? 'console.log' : emitExpression(node.callee);
        return `${callee}(${node.arguments.map(emitExpression).join(', ')})`;
      }
      default: throw new Error(`Unsupported Cannon expression: ${node.type}`);
    }
  }

  return `${emitProgram(ast)}\n`;
}

export function compile(source) { const ast = parse(source); analyze(ast); return { ast, code: emitJavaScript(ast) }; }
