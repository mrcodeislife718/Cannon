const KEYWORDS = new Set(['fn','async','await','return','if','else','while','for','in','break','continue','try','catch','finally','raise','true','false','null','let','const','import','export','from','as','default']);

export class CannonSyntaxError extends SyntaxError {
  constructor(message, line, column) {
    super(`${message} at ${line}:${column}`);
    this.name = 'CannonSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export function lex(source) {
  if (typeof source !== 'string') throw new TypeError('Cannon source must be a string');
  const tokens = [];
  let i = 0, line = 1, column = 1;
  const current = () => source[i];
  const advance = () => { const ch = source[i++]; if (ch === '\n') { line++; column = 1; } else column++; return ch; };
  const push = (type, value, startLine, startColumn) => tokens.push({ type, value, line: startLine, column: startColumn });
  while (i < source.length) {
    const ch = current();
    if (/\s/.test(ch)) { advance(); continue; }
    if (ch === '/' && source[i + 1] === '/') { while (i < source.length && current() !== '\n') advance(); continue; }
    if (ch === '/' && source[i + 1] === '*') {
      const startLine = line, startColumn = column; advance(); advance();
      while (i < source.length && !(current() === '*' && source[i + 1] === '/')) advance();
      if (i >= source.length) throw new CannonSyntaxError('Unterminated block comment', startLine, startColumn);
      advance(); advance(); continue;
    }
    const startLine = line, startColumn = column;
    if (ch === '"' || ch === "'") {
      const quote = advance(); let value = '';
      while (i < source.length && current() !== quote) {
        if (current() === '\\') { advance(); if (i >= source.length) throw new CannonSyntaxError('Unterminated string escape', startLine, startColumn); const esc = advance(); const escapes = { n:'\n', r:'\r', t:'\t', '"':'"', "'":"'", '\\':'\\' }; value += escapes[esc] ?? esc; }
        else value += advance();
      }
      if (current() !== quote) throw new CannonSyntaxError('Unterminated string', startLine, startColumn);
      advance(); push('string', value, startLine, startColumn); continue;
    }
    if (/\d/.test(ch)) {
      let raw = ''; while (i < source.length && /\d/.test(current())) raw += advance();
      if (current() === '.' && /\d/.test(source[i + 1] ?? '')) { raw += advance(); while (i < source.length && /\d/.test(current())) raw += advance(); }
      push('number', Number(raw), startLine, startColumn); continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let value = ''; while (i < source.length && /[A-Za-z0-9_]/.test(current())) value += advance();
      push(KEYWORDS.has(value) ? value : 'identifier', value, startLine, startColumn); continue;
    }
    const two = source.slice(i, i + 2);
    if (['==','!=','<=','>=','&&','||'].includes(two)) { advance(); advance(); push(two, two, startLine, startColumn); continue; }
    if ('{}()[],.;:+-*/%=<>!'.includes(ch)) { advance(); push(ch, ch, startLine, startColumn); continue; }
    throw new CannonSyntaxError(`Unexpected character ${JSON.stringify(ch)}`, startLine, startColumn);
  }
  tokens.push({ type: 'eof', value: null, line, column });
  return tokens;
}
