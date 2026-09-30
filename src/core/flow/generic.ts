import path from 'node:path';
import type { ClassFacts, FileFacts, ImportRef } from './parse.js';
import type { CalleeRef, FlowEvent, FlowFunction } from './types.js';

/**
 * Lightweight flow readers for languages that do not use Babel.
 *
 * These readers deliberately stay conservative. They map named functions,
 * methods and calls that are visible in source text. When a target is
 * ambiguous, the resolver leaves it unconnected instead of inventing an edge.
 */

export const GENERIC_FLOW_EXTENSIONS = new Set([
  '.java', '.kt', '.kts', '.scala', '.groovy', '.cs', '.fs', '.fsx',
  '.go', '.rs', '.swift', '.dart', '.php',
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.m', '.mm',
  '.py', '.pyw',
  '.sh', '.bash', '.zsh',
]);

interface ClassRange {
  name: string;
  start: number;
  open: number;
  end: number;
  line: number;
  extends: string | null;
  implements: string[];
}

interface FunctionCandidate {
  name: string;
  paramsText: string;
  start: number;
  open: number;
  end: number;
  header: string;
}

const CONTROL_NAMES = new Set([
  'if', 'else', 'for', 'while', 'switch', 'catch', 'try', 'finally', 'return',
  'throw', 'new', 'sizeof', 'typeof', 'synchronized', 'assert', 'when', 'match',
  'super', 'this', 'self', 'print', 'println', 'printf', 'echo',
]);

function emptyFacts(file: string): FileFacts {
  return {
    file,
    functions: [],
    locals: {},
    classes: {},
    objects: {},
    instances: {},
    results: {},
    imports: {},
    exports: {},
    starExports: [],
    error: null,
  };
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** Remove comments and strings without moving any character positions. */
function mask(text: string, hashComments = false): string {
  const out = [...text];
  let state: 'code' | 'line' | 'block' | 'string' = 'code';
  let quote = '';
  let escaped = false;

  for (let i = 0; i < out.length; i += 1) {
    const char = out[i];
    const next = out[i + 1] ?? '';
    if (state === 'line') {
      if (char === '\n') state = 'code';
      else out[i] = ' ';
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        out[i] = out[i + 1] = ' ';
        i += 1;
        state = 'code';
      } else if (char !== '\n') out[i] = ' ';
      continue;
    }
    if (state === 'string') {
      if (char === '\n' && quote !== '`') {
        state = 'code';
        escaped = false;
      } else if (!escaped && char === quote) {
        out[i] = ' ';
        state = 'code';
      } else {
        if (char !== '\n') out[i] = ' ';
        escaped = !escaped && char === '\\';
        if (char !== '\\') escaped = false;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      out[i] = out[i + 1] = ' ';
      i += 1;
      state = 'line';
    } else if (char === '/' && next === '*') {
      out[i] = out[i + 1] = ' ';
      i += 1;
      state = 'block';
    } else if (hashComments && char === '#') {
      out[i] = ' ';
      state = 'line';
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out[i] = ' ';
      state = 'string';
      escaped = false;
    }
  }
  return out.join('');
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function matchingParen(text: string, open: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (!escaped && char === quote) quote = '';
      escaped = !escaped && char === '\\';
      if (char !== '\\') escaped = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return Math.min(text.length - 1, open + 160);
}

function simpleType(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[?\[\],]/g, ' ')
    .trim()
    .split(/[\s.:]+/)
    .filter(Boolean)
    .at(-1) ?? '';
}

function parameters(text: string): { names: string[]; types: Record<string, string> } {
  const names: string[] = [];
  const types: Record<string, string> = {};
  for (const raw of text.split(',')) {
    const clean = raw.replace(/@\w+(?:\([^)]*\))?/g, '').replace(/=.*/, '').trim();
    if (!clean) continue;
    const colon = clean.match(/(?:val\s+|var\s+)?([A-Za-z_$][\w$]*)\s*:\s*([^=]+)/);
    if (colon) {
      names.push(colon[1]);
      const type = simpleType(colon[2]);
      if (type) types[colon[1]] = type;
      continue;
    }
    const parts = clean.replace(/\b(?:final|const|ref|out|in|mut)\b/g, '').trim().split(/\s+/);
    const name = parts.at(-1)?.replace(/[^A-Za-z0-9_$].*$/, '') ?? '';
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    names.push(name);
    const type = simpleType(parts.slice(0, -1).join(' '));
    if (type) types[name] = type;
  }
  return { names, types };
}

function callee(names: string[]): CalleeRef {
  if (names.length === 1) return { kind: 'name', name: names[0] };
  if (names.length === 2) {
    if (names[0] === 'this' || names[0] === 'self') return { kind: 'this', name: names[1] };
    if (names[0] === 'super') return { kind: 'super', name: names[1] };
    return { kind: 'member', object: names[0], name: names[1] };
  }
  if (names[0] === 'this' || names[0] === 'self') {
    return { kind: 'thisField', field: names[1], name: names.at(-1) as string };
  }
  return { kind: 'member', object: names.at(-2) as string, name: names.at(-1) as string };
}

function callsIn(original: string, cleaned: string, start: number, end: number): FlowEvent[] {
  const body = cleaned.slice(start, end);
  const events: FlowEvent[] = [];
  const callPattern = /\b(?:[A-Za-z_$][\w$]*\s*\.\s*){0,2}[A-Za-z_$][\w$]*\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(body)) !== null) {
    const compact = match[0].slice(0, match[0].lastIndexOf('(')).replace(/\s+/g, '');
    const names = compact.split('.');
    const name = names.at(-1) as string;
    if (CONTROL_NAMES.has(name)) continue;
    const absolute = start + match.index;
    const open = absolute + match[0].lastIndexOf('(');
    const close = matchingParen(original, open);
    const text = original.slice(absolute, Math.min(close + 1, absolute + 180)).replace(/\s+/g, ' ').trim();
    events.push({
      type: 'call',
      at: close,
      line: lineOf(original, absolute),
      text,
      callee: callee(names),
      path: [],
      context: [],
    });
  }
  return events;
}

function springRoute(text: string, start: number, headerEnd: number, owner: ClassRange | null): string | null {
  const header = text.slice(start, headerEnd);
  const matches = [...header.matchAll(/@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\s*(?:\(([^)]*)\))?/g)];
  const match = matches.at(-1);
  if (!match) return null;

  const names: Record<string, string> = {
    GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', PatchMapping: 'PATCH', DeleteMapping: 'DELETE',
  };
  const args = match[2] ?? '';
  const requestMethod = /RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/.exec(args)?.[1];
  const method = names[match[1]] ?? requestMethod ?? 'ANY';
  const ownPath = /["']([^"']*)["']/.exec(args)?.[1] ?? '';

  let base = '';
  if (owner) {
    // Java annotations sit above the class declaration, so include the small
    // area before `class`, not only the declaration itself.
    const ownerHeader = text.slice(Math.max(0, owner.start - 700), owner.open);
    const baseMatch = /@RequestMapping\s*\(([^)]*)\)/.exec(ownerHeader);
    base = baseMatch ? /["']([^"']*)["']/.exec(baseMatch[1])?.[1] ?? '' : '';
  }
  const joined = `${base}/${ownPath}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  return `${method} ${joined.startsWith('/') ? joined : `/${joined}`}`;
}

function braceFacts(file: string, text: string): FileFacts {
  const facts = emptyFacts(file);
  const cleaned = mask(text, path.extname(file).toLowerCase() === '.sh');
  const classes: ClassRange[] = [];
  const classPattern = /(^|\n)[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|sealed|partial|open|data)\s+)*(?:class|interface|record|enum|struct|trait|object|protocol)\s+([A-Za-z_$][\w$]*)([^\n{]*)\{/gm;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classPattern.exec(cleaned)) !== null) {
    const open = classMatch.index + classMatch[0].lastIndexOf('{');
    const rest = classMatch[3] ?? '';
    const extend = /\bextends\s+([A-Za-z_$][\w$.:]*)/.exec(rest)?.[1] ?? null;
    const implemented = /\bimplements\s+([^\n{]+)/.exec(rest)?.[1] ?? '';
    classes.push({
      name: classMatch[2],
      start: classMatch.index,
      open,
      end: matchingBrace(cleaned, open),
      line: lineOf(text, classMatch.index),
      extends: extend ? simpleType(extend) : null,
      implements: implemented.split(',').map(simpleType).filter(Boolean),
    });
  }

  const candidates: FunctionCandidate[] = [];
  const patterns: Array<{ re: RegExp; name: number; params: number }> = [
    {
      re: /(^|\n)[ \t]*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|native|default|virtual|override|async|unsafe|extern|inline|constexpr)\s+)*(?:<[^>\n]+>\s*)?(?:[A-Za-z_$][\w$.[\]<>?,]*\s+)+([A-Za-z_$][\w$]*)\s*\(([^(){};]*)\)\s*(?:throws\b[^\n{]*)?\{/gm,
      name: 2,
      params: 3,
    },
    {
      re: /(^|\n)[ \t]*(?:(?:public|private|protected|internal|static|final)\s+)*([A-Z][A-Za-z0-9_$]*)\s*\(([^(){};]*)\)\s*(?:throws\b[^\n{]*)?\{/gm,
      name: 2,
      params: 3,
    },
    {
      re: /(^|\n)[ \t]*(?:(?:pub|public|private|protected|internal|static|async|unsafe|export)\s+)*(?:fun|fn|func)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)\s*\(([^()]*)\)[^;{}\n]*\{/gm,
      name: 2,
      params: 3,
    },
    {
      re: /(^|\n)[ \t]*(?:(?:public|private|protected|static|final)\s+)*function\s+&?\s*([A-Za-z_$][\w$]*)\s*\(([^()]*)\)[^;{}\n]*\{/gm,
      name: 2,
      params: 3,
    },
    {
      re: /(^|\n)[ \t]*([A-Za-z_][\w]*)\s*\(\s*\)\s*\{/gm,
      name: 2,
      params: 0,
    },
  ];

  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(cleaned)) !== null) {
      const name = match[pattern.name];
      if (!name || CONTROL_NAMES.has(name)) continue;
      const open = match.index + match[0].lastIndexOf('{');
      candidates.push({
        name,
        paramsText: pattern.params ? match[pattern.params] ?? '' : '',
        start: match.index + (match[1]?.length ?? 0),
        open,
        end: matchingBrace(cleaned, open),
        header: match[0],
      });
    }
  }

  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: FunctionCandidate[] = [];
  const seenOpen = new Set<number>();
  for (const candidate of candidates) {
    if (seenOpen.has(candidate.open)) continue;
    if (accepted.some((outer) => candidate.start > outer.open && candidate.start < outer.end)) continue;
    seenOpen.add(candidate.open);
    accepted.push(candidate);
  }

  const idCounts = new Map<string, number>();
  for (const candidate of accepted) {
    const owner = classes
      .filter((cls) => candidate.start > cls.open && candidate.start < cls.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0] ?? null;
    const base = `${file}#${owner ? `${owner.name}.` : ''}${candidate.name}`;
    const count = (idCounts.get(base) ?? 0) + 1;
    idCounts.set(base, count);
    const line = lineOf(text, candidate.start);
    const id = count === 1 ? base : `${base}@${line}`;
    const parsedParams = parameters(candidate.paramsText);
    const localTypes = { ...parsedParams.types };
    const bodyClean = cleaned.slice(candidate.open + 1, candidate.end);

    const localPattern = /\b([A-Z][A-Za-z0-9_$.:]*(?:<[^;=(){}]+>)?(?:\[\])?)\s+([a-zA-Z_$][\w$]*)\s*(?==|;|,)/g;
    let localMatch: RegExpExecArray | null;
    while ((localMatch = localPattern.exec(bodyClean)) !== null) {
      const type = simpleType(localMatch[1]);
      if (type) localTypes[localMatch[2]] = type;
    }
    const typedPattern = /\b(?:val|var)\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$.:<>?]*)/g;
    while ((localMatch = typedPattern.exec(bodyClean)) !== null) {
      const type = simpleType(localMatch[2]);
      if (type) localTypes[localMatch[1]] = type;
    }

    const route = springRoute(text, candidate.start, candidate.open, owner);
    const fn: FlowFunction = {
      id,
      name: candidate.name,
      owner: owner?.name ?? null,
      kind: route ? 'route' : owner ? 'method' : 'function',
      route,
      file,
      line,
      endLine: lineOf(text, candidate.end),
      params: parsedParams.names,
      exported: /\b(?:public|pub|export)\b/.test(candidate.header),
      events: callsIn(text, cleaned, candidate.open + 1, candidate.end),
      branches: [],
      localTypes,
      localResults: {},
      localFns: {},
      parent: null,
    };
    facts.functions.push(fn);
    if (owner) {
      const cls = (facts.classes[owner.name] ??= {
        name: owner.name,
        line: owner.line,
        methods: {},
        fields: {},
        extends: owner.extends,
        implements: owner.implements,
      });
      cls.methods[candidate.name] ??= id;
    } else {
      facts.locals[candidate.name] ??= id;
    }
  }

  for (const cls of classes) {
    const out: ClassFacts = (facts.classes[cls.name] ??= {
      name: cls.name,
      line: cls.line,
      methods: {},
      fields: {},
      extends: cls.extends,
      implements: cls.implements,
    });
    const classBody = cleaned.slice(cls.open + 1, cls.end);
    const fieldPattern = /(^|\n)[ \t]*(?:(?:public|private|protected|internal|static|final|readonly|lateinit|volatile|transient)\s+)*([A-Z][A-Za-z0-9_$.:]*(?:<[^;=(){}]+>)?(?:\[\])?)\s+([A-Za-z_$][\w$]*)\s*(?==|;)/gm;
    let match: RegExpExecArray | null;
    while ((match = fieldPattern.exec(classBody)) !== null) {
      const absolute = cls.open + 1 + match.index;
      if (accepted.some((fn) => absolute > fn.open && absolute < fn.end)) continue;
      const type = simpleType(match[2]);
      if (type) out.fields[match[3]] = type;
    }
  }

  const importPatterns: Array<{ re: RegExp; source: number }> = [
    { re: /^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/gm, source: 1 },
    { re: /^\s*using\s+([\w.]+)\s*;/gm, source: 1 },
    { re: /^\s*use\s+([\w:]+)(?:::\{[^}]+\})?\s*;/gm, source: 1 },
    { re: /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm, source: 1 },
  ];
  for (const pattern of importPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(text)) !== null) {
      const source = match[pattern.source];
      if (!source || source.endsWith('*')) continue;
      const imported = source.split(/[.:/]+/).filter(Boolean).at(-1);
      if (imported) facts.imports[imported] = { source, imported } satisfies ImportRef;
    }
  }

  return facts;
}

function indentationEnd(lines: string[], start: number, indent: number): number {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const nextIndent = /^\s*/.exec(line)?.[0].replace(/\t/g, '    ').length ?? 0;
    if (nextIndent <= indent && !/^\s*@/.test(line)) return i;
  }
  return end;
}

function pythonFacts(file: string, text: string): FileFacts {
  const facts = emptyFacts(file);
  const lines = text.split(/\r?\n/);
  const classes: Array<{ name: string; line: number; indent: number; end: number }> = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)class\s+([A-Za-z_][\w]*)/.exec(line);
    if (!match) return;
    const indent = match[1].replace(/\t/g, '    ').length;
    classes.push({ name: match[2], line: index + 1, indent, end: indentationEnd(lines, index, indent) });
    facts.classes[match[2]] = { name: match[2], line: index + 1, methods: {}, fields: {}, extends: null, implements: [] };
  });

  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  lines.forEach((line, index) => {
    const match = /^(\s*)(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/.exec(line);
    if (!match) return;
    const indent = match[1].replace(/\t/g, '    ').length;
    const endIndex = indentationEnd(lines, index, indent);
    const owner = classes
      .filter((cls) => cls.line - 1 < index && cls.end > index && cls.indent < indent)
      .sort((a, b) => b.indent - a.indent)[0];
    const base = `${file}#${owner ? `${owner.name}.` : ''}${match[2]}`;
    const id = facts.functions.some((fn) => fn.id === base) ? `${base}@${index + 1}` : base;
    const parsedParams = parameters(match[3].replace(/\b(?:self|cls)\s*,?/, ''));
    const start = offsets[index] + line.length + 1;
    const end = offsets[Math.min(endIndex, lines.length - 1)] ?? text.length;
    const before = lines.slice(Math.max(0, index - 4), index).join('\n');
    const routeMatch = /@(\w+)\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/.exec(before);
    const route = routeMatch ? `${routeMatch[2].toUpperCase()} ${routeMatch[3]}` : null;
    const fn: FlowFunction = {
      id,
      name: match[2],
      owner: owner?.name ?? null,
      kind: route ? 'route' : owner ? 'method' : 'function',
      route,
      file,
      line: index + 1,
      endLine: Math.max(index + 1, endIndex),
      params: parsedParams.names,
      exported: !match[2].startsWith('_'),
      events: callsIn(text, mask(text, true), start, end),
      branches: [],
      localTypes: parsedParams.types,
      localResults: {},
      localFns: {},
      parent: null,
    };
    facts.functions.push(fn);
    if (owner) facts.classes[owner.name].methods[fn.name] ??= id;
    else facts.locals[fn.name] ??= id;
  });

  for (const match of text.matchAll(/^\s*from\s+([\w.]+)\s+import\s+([A-Za-z_][\w]*)|^\s*import\s+([\w.]+)/gm)) {
    const source = match[1] ?? match[3];
    const imported = match[2] ?? source?.split('.').at(-1);
    if (source && imported) facts.imports[imported] = { source, imported };
  }
  return facts;
}

export function readGenericFlowFacts(file: string, text: string): FileFacts {
  const extension = path.extname(file).toLowerCase();
  return extension === '.py' || extension === '.pyw' ? pythonFacts(file, text) : braceFacts(file, text);
}
