import { parse } from './parser.js';

function indent(level) { return '  '.repeat(level); }

export function emitJavaScript(ast) {
  const declaredScopes = [new Set()];
  const currentScope = () => declaredScopes[declaredScopes.length - 1];

  function emitProgram(node) {
    return node.body.map((statement) => emitStatement(statement, 0)).join('\n');
  }

  function emitBlock(node, level) {
    return `{\n${node.body.map((statement) => emitStatement(statement, level + 1)).join('\n')}\n${indent(level)}}`;
  }

  function emitStatement(node, level) {
    const pad = indent(level);
    switch (node.type) {
      case 'VariableDeclaration': {
        currentScope().add(node.name);
        return `${pad}${node.kind} ${node.name} = ${emitExpression(node.value)};`;
      }
      case 'AssignmentStatement': {
        if (node.target.type === 'Identifier') {
          const firstAssignment = !currentScope().has(node.target.name);
          currentScope().add(node.target.name);
          return `${pad}${firstAssignment ? 'let ' : ''}${node.target.name} = ${emitExpression(node.value)};`;
        }
        return `${pad}${emitExpression(node.target)} = ${emitExpression(node.value)};`;
      }
      case 'ExpressionStatement':
        return `${pad}${emitExpression(node.expression)};`;
      case 'ReturnStatement':
        return `${pad}return${node.value ? ` ${emitExpression(node.value)}` : ''};`;
      case 'FunctionDeclaration': {
        currentScope().add(node.name);
        declaredScopes.push(new Set(node.params));
        const body = emitBlock(node.body, level);
        declaredScopes.pop();
        return `${pad}function ${node.name}(${node.params.join(', ')}) ${body}`;
      }
      case 'IfStatement': {
        const consequent = emitBlock(node.consequent, level);
        let result = `${pad}if (${emitExpression(node.test)}) ${consequent}`;
        if (node.alternate) {
          if (node.alternate.type === 'IfStatement') result += ` else ${emitStatement(node.alternate, level).trimStart()}`;
          else result += ` else ${emitBlock(node.alternate, level)}`;
        }
        return result;
      }
      case 'WhileStatement':
        return `${pad}while (${emitExpression(node.test)}) ${emitBlock(node.body, level)}`;
      case 'BlockStatement':
        return `${pad}${emitBlock(node, level)}`;
      default:
        throw new Error(`Unsupported Cannon statement: ${node.type}`);
    }
  }

  function emitExpression(node) {
    switch (node.type) {
      case 'Literal': return JSON.stringify(node.value);
      case 'Identifier': return node.name;
      case 'ArrayExpression': return `[${node.elements.map(emitExpression).join(', ')}]`;
      case 'ObjectExpression': return `{ ${node.properties.map((property) => `${JSON.stringify(property.key)}: ${emitExpression(property.value)}`).join(', ')} }`;
      case 'MemberExpression': return node.computed
        ? `${emitExpression(node.object)}[${emitExpression(node.property)}]`
        : `${emitExpression(node.object)}.${node.property.name}`;
      case 'UnaryExpression': return `(${node.operator}${emitExpression(node.argument)})`;
      case 'BinaryExpression': {
        const operator = node.operator === '==' ? '===' : node.operator === '!=' ? '!==' : node.operator;
        return `(${emitExpression(node.left)} ${operator} ${emitExpression(node.right)})`;
      }
      case 'CallExpression': {
        const callee = node.callee.type === 'Identifier' && node.callee.name === 'print'
          ? 'console.log'
          : emitExpression(node.callee);
        return `${callee}(${node.arguments.map(emitExpression).join(', ')})`;
      }
      default:
        throw new Error(`Unsupported Cannon expression: ${node.type}`);
    }
  }

  return `${emitProgram(ast)}\n`;
}

export function compile(source) {
  const ast = parse(source);
  return { ast, code: emitJavaScript(ast) };
}
