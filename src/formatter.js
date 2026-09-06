import { parse } from './parser.js';

export function format(source) {
  return printProgram(parse(source)) + '\n';
}

function printProgram(ast) {
  return ast.body.map((node) => printStatement(node, 0)).join('\n');
}

function printStatement(node, level) {
  const pad = '  '.repeat(level);
  switch (node.type) {
    case 'ImportDeclaration': return `${pad}${printImport(node)}`;
    case 'ExportDefaultDeclaration': return `${pad}export default ${printExportDefault(node.declaration, level)}`;
    case 'ExportNamedDeclaration': return `${pad}${printNamedExport(node, level)}`;
    case 'VariableDeclaration': return `${pad}${node.kind} ${node.name} = ${printExpression(node.value)}`;
    case 'AssignmentStatement': return `${pad}${printAssignment(node)}`;
    case 'ExpressionStatement': return `${pad}${printExpression(node.expression)}`;
    case 'ReturnStatement': return `${pad}return${node.value ? ` ${printExpression(node.value)}` : ''}`;
    case 'BreakStatement': return `${pad}break`;
    case 'ContinueStatement': return `${pad}continue`;
    case 'FunctionDeclaration': return `${pad}${printFunction(node, level)}`;
    case 'IfStatement': return `${pad}if (${printExpression(node.test)}) ${printBlock(node.consequent, level)}${node.alternate ? ` else ${node.alternate.type === 'IfStatement' ? printStatement(node.alternate, level).trimStart() : printBlock(node.alternate, level)}` : ''}`;
    case 'WhileStatement': return `${pad}while (${printExpression(node.test)}) ${printBlock(node.body, level)}`;
    case 'ForStatement': return `${pad}for (${printForClause(node.init)}; ${node.test ? printExpression(node.test) : ''}; ${printForClause(node.update)}) ${printBlock(node.body, level)}`;
    case 'BlockStatement': return `${pad}${printBlock(node, level)}`;
    default: throw new Error(`Unsupported Cannon statement for formatting: ${node.type}`);
  }
}

function printForClause(node) {
  if (!node) return '';
  if (node.type === 'VariableDeclaration') return `${node.kind} ${node.name} = ${printExpression(node.value)}`;
  if (node.type === 'AssignmentStatement') return printAssignment(node);
  if (node.type === 'ExpressionStatement') return printExpression(node.expression);
  throw new Error(`Unsupported Cannon for-clause for formatting: ${node.type}`);
}

function printAssignment(node) {
  return `${printExpression(node.target ?? { type: 'Identifier', name: node.name })} = ${printExpression(node.value)}`;
}

function printImport(node) {
  const source = JSON.stringify(node.source);
  if (node.specifiers.length === 0) return `import ${source}`;
  const defaultSpecifier = node.specifiers.find((s) => s.type === 'ImportDefaultSpecifier');
  const namespaceSpecifier = node.specifiers.find((s) => s.type === 'ImportNamespaceSpecifier');
  const namedSpecifiers = node.specifiers.filter((s) => s.type === 'ImportSpecifier');
  const parts = [];
  if (defaultSpecifier) parts.push(defaultSpecifier.local);
  if (namespaceSpecifier) parts.push(`* as ${namespaceSpecifier.local}`);
  if (namedSpecifiers.length) parts.push(`{ ${namedSpecifiers.map((s) => s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`).join(', ')} }`);
  return `import ${parts.join(', ')} from ${source}`;
}

function printNamedExport(node, level) {
  if (node.declaration) return `export ${printDeclarationWithoutPad(node.declaration, level)}`;
  const names = node.specifiers.map((s) => s.local === s.exported ? s.local : `${s.local} as ${s.exported}`).join(', ');
  return `export { ${names} }${node.source ? ` from ${JSON.stringify(node.source)}` : ''}`;
}

function printExportDefault(declaration, level) {
  if (declaration.type === 'FunctionDeclaration') return printFunction(declaration, level);
  return printExpression(declaration);
}

function printDeclarationWithoutPad(node, level) {
  if (node.type === 'VariableDeclaration') return `${node.kind} ${node.name} = ${printExpression(node.value)}`;
  if (node.type === 'FunctionDeclaration') return printFunction(node, level);
  throw new Error(`Unsupported Cannon export declaration for formatting: ${node.type}`);
}

function printFunction(node, level) {
  return `${node.async ? 'async ' : ''}fn ${node.name}(${node.params.join(', ')}) ${printBlock(node.body, level)}`;
}

function printBlock(node, level) {
  return `{\n${node.body.map((statement) => printStatement(statement, level + 1)).join('\n')}\n${'  '.repeat(level)}}`;
}

function printExpression(node) {
  switch (node.type) {
    case 'Literal': return JSON.stringify(node.value);
    case 'Identifier': return node.name;
    case 'ArrayExpression': return `[${node.elements.map(printExpression).join(', ')}]`;
    case 'ObjectExpression': return `{ ${node.properties.map((property) => `${JSON.stringify(property.key)}: ${printExpression(property.value)}`).join(', ')} }`;
    case 'MemberExpression': return node.computed ? `${printExpression(node.object)}[${printExpression(node.property)}]` : `${printExpression(node.object)}.${node.property.name}`;
    case 'UnaryExpression': return `${node.operator}${printExpression(node.argument)}`;
    case 'AwaitExpression': return `await ${printExpression(node.argument)}`;
    case 'BinaryExpression': return `${printExpression(node.left)} ${node.operator} ${printExpression(node.right)}`;
    case 'CallExpression': return `${printExpression(node.callee)}(${node.arguments.map(printExpression).join(', ')})`;
    default: throw new Error(`Unsupported Cannon expression for formatting: ${node.type}`);
  }
}
