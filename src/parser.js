import { lex, CannonSyntaxError } from './lexer.js';

export function parse(source) {
  const tokens = lex(source);
  let i = 0;
  const current = () => tokens[i];
  const peek = (offset = 1) => tokens[i + offset] ?? tokens[tokens.length - 1];
  const match = (...types) => types.includes(current().type);
  const take = (type) => { const token = current(); if (token.type !== type) throw new CannonSyntaxError(`Expected ${type}, found ${token.type}`, token.line, token.column); i++; return token; };
  const optional = (type) => match(type) ? take(type) : null;

  function parseProgram() { const body = []; while (!match('eof')) body.push(parseStatement()); return { type: 'Program', body }; }
  function parseStatement() {
    if (match('import')) return parseImport();
    if (match('export')) return parseExport();
    if (match('fn') || (match('async') && peek().type === 'fn')) return parseFunction();
    if (match('return')) return parseReturn();
    if (match('if')) return parseIf();
    if (match('while')) return parseWhile();
    if (match('for')) return parseFor();
    if (match('break')) { take('break'); optional(';'); return { type: 'BreakStatement' }; }
    if (match('continue')) { take('continue'); optional(';'); return { type: 'ContinueStatement' }; }
    if (match('let','const')) return parseDeclaration();
    if (match('{')) return parseBlock();
    const expression = parseExpression();
    if (optional('=')) {
      if (!['Identifier','MemberExpression'].includes(expression.type)) { const token = current(); throw new CannonSyntaxError('Invalid assignment target', token.line, token.column); }
      const value = parseExpression(); optional(';'); return { type: 'AssignmentStatement', target: expression, ...(expression.type === 'Identifier' ? { name: expression.name } : {}), value };
    }
    optional(';'); return { type: 'ExpressionStatement', expression };
  }

  function parseImport() {
    take('import');
    if (match('string')) { const source = take('string').value; optional(';'); return { type: 'ImportDeclaration', source, specifiers: [] }; }
    const specifiers = [];
    if (match('*')) { take('*'); take('as'); specifiers.push({ type: 'ImportNamespaceSpecifier', local: take('identifier').value }); }
    else if (match('{')) { take('{'); while (!match('}')) { const imported = take('identifier').value; let local = imported; if (optional('as')) local = take('identifier').value; specifiers.push({ type:'ImportSpecifier', imported, local }); if (!optional(',')) break; } take('}'); }
    else { const local = take('identifier').value; specifiers.push({ type:'ImportDefaultSpecifier', local }); if (optional(',')) { if (match('*')) { take('*'); take('as'); specifiers.push({ type:'ImportNamespaceSpecifier', local:take('identifier').value }); } else { take('{'); while(!match('}')) { const imported=take('identifier').value; let namedLocal=imported; if(optional('as')) namedLocal=take('identifier').value; specifiers.push({type:'ImportSpecifier',imported,local:namedLocal}); if(!optional(',')) break; } take('}'); } } }
    take('from'); const source = take('string').value; optional(';'); return { type:'ImportDeclaration', source, specifiers };
  }
  function parseExport() {
    take('export');
    if (optional('default')) { if (match('fn') || (match('async') && peek().type==='fn')) return { type:'ExportDefaultDeclaration', declaration:parseFunction() }; const declaration=parseExpression(); optional(';'); return { type:'ExportDefaultDeclaration', declaration }; }
    if (match('fn') || (match('async') && peek().type==='fn') || match('let','const')) { const declaration=match('let','const')?parseDeclaration():parseFunction(); return { type:'ExportNamedDeclaration', declaration, specifiers:[], source:null }; }
    take('{'); const specifiers=[]; while(!match('}')) { const local=take('identifier').value; let exported=local; if(optional('as')) exported=take('identifier').value; specifiers.push({local,exported}); if(!optional(',')) break; } take('}'); let source=null; if(optional('from')) source=take('string').value; optional(';'); return { type:'ExportNamedDeclaration', declaration:null, specifiers, source };
  }
  function parseFunction() { const async=Boolean(optional('async')); take('fn'); const name=take('identifier').value; take('('); const params=[]; if(!match(')')) do { params.push(take('identifier').value); } while(optional(',')); take(')'); return { type:'FunctionDeclaration', name, params, async, body:parseBlock() }; }
  function parseReturn() { take('return'); const value=match(';','}')?null:parseExpression(); optional(';'); return { type:'ReturnStatement', value }; }
  function parseIf() { take('if'); take('('); const test=parseExpression(); take(')'); const consequent=parseBlock(); let alternate=null; if(optional('else')) alternate=match('if')?parseIf():parseBlock(); return { type:'IfStatement', test, consequent, alternate }; }
  function parseWhile() { take('while'); take('('); const test=parseExpression(); take(')'); return { type:'WhileStatement', test, body:parseBlock() }; }
  function parseFor() {
    take('for'); take('(');
    let init = null;
    if (!match(';')) init = match('let','const') ? parseDeclaration(false) : parseForClauseExpression();
    take(';');
    const test = match(';') ? null : parseExpression();
    take(';');
    const update = match(')') ? null : parseForClauseExpression();
    take(')');
    return { type:'ForStatement', init, test, update, body:parseBlock() };
  }
  function parseForClauseExpression() {
    const expression = parseExpression();
    if (optional('=')) {
      if (!['Identifier','MemberExpression'].includes(expression.type)) { const token=current(); throw new CannonSyntaxError('Invalid assignment target',token.line,token.column); }
      return { type:'AssignmentStatement', target:expression, ...(expression.type==='Identifier'?{name:expression.name}:{}), value:parseExpression() };
    }
    return { type:'ExpressionStatement', expression };
  }
  function parseDeclaration(consumeTerminator = true) { const kind=current().type; i++; const name=take('identifier').value; take('='); const value=parseExpression(); if(consumeTerminator) optional(';'); return { type:'VariableDeclaration', kind, name, value }; }
  function parseBlock() { take('{'); const body=[]; while(!match('}')) { if(match('eof')) { const token=current(); throw new CannonSyntaxError('Unterminated block',token.line,token.column); } body.push(parseStatement()); } take('}'); return { type:'BlockStatement', body }; }

  const PRECEDENCE = new Map([['||',1],['&&',2],['==',3],['!=',3],['<',4],['<=',4],['>',4],['>=',4],['+',5],['-',5],['*',6],['/',6],['%',6]]);
  function parseExpression(minPrecedence=0) { let left=parseUnary(); while(true) { const op=current().type, precedence=PRECEDENCE.get(op); if(precedence===undefined||precedence<minPrecedence) break; i++; const right=parseExpression(precedence+1); left={type:'BinaryExpression',operator:op,left,right}; } return left; }
  function parseUnary() { if(match('await')) { take('await'); return {type:'AwaitExpression',argument:parseUnary()}; } if(match('!','-','+')) { const operator=current().type; i++; return {type:'UnaryExpression',operator,argument:parseUnary()}; } return parsePostfix(); }
  function parsePostfix() { let expression=parsePrimary(); while(true) { if(match('(')) { take('('); const args=[]; if(!match(')')) do { args.push(parseExpression()); } while(optional(',')); take(')'); expression={type:'CallExpression',callee:expression,arguments:args}; continue; } if(match('.')) { take('.'); expression={type:'MemberExpression',object:expression,property:{type:'Identifier',name:take('identifier').value},computed:false}; continue; } if(match('[')) { take('['); const property=parseExpression(); take(']'); expression={type:'MemberExpression',object:expression,property,computed:true}; continue; } break; } return expression; }
  function parseArray() { take('['); const elements=[]; while(!match(']')) { elements.push(parseExpression()); if(!optional(',')) break; if(match(']')) break; } take(']'); return {type:'ArrayExpression',elements}; }
  function parseObject() { take('{'); const properties=[]; while(!match('}')) { const keyToken=current(); if(!match('identifier','string')) throw new CannonSyntaxError('Object keys must be identifiers or strings',keyToken.line,keyToken.column); i++; take(':'); properties.push({key:keyToken.value,value:parseExpression()}); if(!optional(',')) break; if(match('}')) break; } take('}'); return {type:'ObjectExpression',properties}; }
  function parsePrimary() { const token=current(); if(match('number','string')) { i++; return {type:'Literal',value:token.value}; } if(match('true','false')) { i++; return {type:'Literal',value:token.type==='true'}; } if(match('null')) { i++; return {type:'Literal',value:null}; } if(match('identifier')) { i++; return {type:'Identifier',name:token.value}; } if(match('[')) return parseArray(); if(match('{')) return parseObject(); if(match('(')) { take('('); const expression=parseExpression(); take(')'); return expression; } throw new CannonSyntaxError(`Expected expression, found ${token.type}`,token.line,token.column); }
  return parseProgram();
}
