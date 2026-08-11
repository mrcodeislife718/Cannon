import { lex, CannonSyntaxError } from './lexer.js';

export function parse(source) {
  const tokens = lex(source);
  let i = 0;
  const current = () => tokens[i];
  const match = (...types) => types.includes(current().type);
  const take = (type) => {
    const token = current();
    if (token.type !== type) throw new CannonSyntaxError(`Expected ${type}, found ${token.type}`, token.line, token.column);
    i++;
    return token;
  };
  const optional = (type) => match(type) ? take(type) : null;

  function parseProgram() {
    const body = [];
    while (!match('eof')) body.push(parseStatement());
    return { type: 'Program', body };
  }

  function parseStatement() {
    if (match('fn')) return parseFunction();
    if (match('return')) return parseReturn();
    if (match('if')) return parseIf();
    if (match('while')) return parseWhile();
    if (match('let','const')) return parseDeclaration();
    if (match('{')) return parseBlock();

    if (match('identifier') && tokens[i + 1]?.type === '=') {
      const name = take('identifier').value;
      take('=');
      const value = parseExpression();
      optional(';');
      return { type: 'AssignmentStatement', name, value };
    }

    const expression = parseExpression();
    optional(';');
    return { type: 'ExpressionStatement', expression };
  }

  function parseFunction() {
    take('fn');
    const name = take('identifier').value;
    take('(');
    const params = [];
    if (!match(')')) {
      do {
        params.push(take('identifier').value);
      } while (optional(','));
    }
    take(')');
    return { type: 'FunctionDeclaration', name, params, body: parseBlock() };
  }

  function parseReturn() {
    take('return');
    const value = match(';','}') ? null : parseExpression();
    optional(';');
    return { type: 'ReturnStatement', value };
  }

  function parseIf() {
    take('if');
    take('(');
    const test = parseExpression();
    take(')');
    const consequent = parseBlock();
    let alternate = null;
    if (optional('else')) alternate = match('if') ? parseIf() : parseBlock();
    return { type: 'IfStatement', test, consequent, alternate };
  }

  function parseWhile() {
    take('while');
    take('(');
    const test = parseExpression();
    take(')');
    return { type: 'WhileStatement', test, body: parseBlock() };
  }

  function parseDeclaration() {
    const kind = current().type;
    i++;
    const name = take('identifier').value;
    take('=');
    const value = parseExpression();
    optional(';');
    return { type: 'VariableDeclaration', kind, name, value };
  }

  function parseBlock() {
    take('{');
    const body = [];
    while (!match('}')) {
      if (match('eof')) {
        const token = current();
        throw new CannonSyntaxError('Unterminated block', token.line, token.column);
      }
      body.push(parseStatement());
    }
    take('}');
    return { type: 'BlockStatement', body };
  }

  const PRECEDENCE = new Map([
    ['||',1], ['&&',2], ['==',3], ['!=',3], ['<',4], ['<=',4], ['>',4], ['>=',4],
    ['+',5], ['-',5], ['*',6], ['/',6], ['%',6],
  ]);

  function parseExpression(minPrecedence = 0) {
    let left = parseUnary();
    while (true) {
      const op = current().type;
      const precedence = PRECEDENCE.get(op);
      if (precedence === undefined || precedence < minPrecedence) break;
      i++;
      const right = parseExpression(precedence + 1);
      left = { type: 'BinaryExpression', operator: op, left, right };
    }
    return left;
  }

  function parseUnary() {
    if (match('!','-','+')) {
      const operator = current().type;
      i++;
      return { type: 'UnaryExpression', operator, argument: parseUnary() };
    }
    return parseCall();
  }

  function parseCall() {
    let expression = parsePrimary();
    while (match('(')) {
      take('(');
      const args = [];
      if (!match(')')) {
        do { args.push(parseExpression()); } while (optional(','));
      }
      take(')');
      expression = { type: 'CallExpression', callee: expression, arguments: args };
    }
    return expression;
  }

  function parsePrimary() {
    const token = current();
    if (match('number','string')) { i++; return { type: 'Literal', value: token.value }; }
    if (match('true','false')) { i++; return { type: 'Literal', value: token.type === 'true' }; }
    if (match('null')) { i++; return { type: 'Literal', value: null }; }
    if (match('identifier')) { i++; return { type: 'Identifier', name: token.value }; }
    if (match('(')) {
      take('(');
      const expression = parseExpression();
      take(')');
      return expression;
    }
    throw new CannonSyntaxError(`Expected expression, found ${token.type}`, token.line, token.column);
  }

  return parseProgram();
}
