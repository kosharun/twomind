import { readFileSync } from 'node:fs';
import path from 'node:path';
import { displayName } from './graph.js';
import type { FileFacts, ImportRef, ValueRef } from './parse.js';
import type { CalleeRef, FlowEvent, FlowFunction } from './types.js';

/**
 * Connect the files: turn "this calls repo.save()" into "this calls the save
 * method in src/tickets/ticket.repository.ts", or into "this calls pg, a
 * package outside the project".
 *
 * It follows imports, require(), classes, `this.x` fields with a TS type or a
 * `new X()`, and object exports. When two things could match, it does not
 * pick one: the call is left out of the flow instead of pointing somewhere
 * that only has the same name.
 */

export type Target =
  | { kind: 'fn'; id: string }
  | { kind: 'external'; module: string; name: string }
  | { kind: 'none' };

const NONE: Target = { kind: 'none' };

/** Packages whose calls are plumbing (joining paths, formatting), not a step in a flow. */
const QUIET_MODULES = new Set(['path', 'url', 'util', 'querystring', 'assert', 'clsx', 'classnames']);

/** React hooks and helpers are how a component is built, not what it does. */
const QUIET_NAMES = /^(use[A-Z]\w*|createElement|forwardRef|memo|lazy|createContext)$/;

const TRY_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

export interface PathAliases {
  baseUrl: string | null;
  paths: Array<{ prefix: string; targets: string[] }>;
}

export interface FlowProject {
  root: string;
  builtAt: string;
  files: Map<string, FileFacts>;
  functions: Map<string, FlowFunction>;
  /** For every function, the target of each of its events, in the same order. */
  targets: Map<string, Target[]>;
  /** Who calls each function, inside the project. */
  callers: Map<string, string[]>;
  parseErrors: Array<{ file: string; error: string }>;
}

export interface FunctionSummary {
  id: string;
  /** How to show it: `TicketService.changeStatus()`, `POST /orders`, `server.js, top level`. */
  label: string;
  name: string;
  owner: string | null;
  route: string | null;
  kind: FlowFunction['kind'];
  file: string;
  line: number;
  /** Calls it makes that the flow can follow, in the project or out of it. */
  calls: number;
  calledBy: number;
}

type Value =
  | { kind: 'fn'; id: string }
  | { kind: 'class'; file: string; name: string }
  | { kind: 'object'; file: string; members: Record<string, ValueRef> }
  | { kind: 'instance'; file: string; className: string }
  | { kind: 'module'; file: string }
  | { kind: 'external'; module: string; name: string };

type ClassRef = { file: string; name: string } | { external: string };

export function buildFlowProject(root: string, facts: FileFacts[], aliases: PathAliases): FlowProject {
  const files = new Map(facts.map((f) => [f.file, f]));
  const functions = new Map<string, FlowFunction>();
  for (const f of facts) for (const fn of f.functions) functions.set(fn.id, fn);

  const resolver = new Resolver(files, functions, aliases);
  const targets = new Map<string, Target[]>();
  const callers = new Map<string, string[]>();

  for (const fn of functions.values()) {
    const list = fn.events.map((event) => resolver.resolve(fn, event));
    targets.set(fn.id, list);
    for (const target of list) {
      if (target.kind !== 'fn' || target.id === fn.id) continue;
      const into = callers.get(target.id) ?? [];
      if (!into.includes(fn.id)) into.push(fn.id);
      callers.set(target.id, into);
    }
  }

  return {
    root,
    builtAt: new Date().toISOString(),
    files,
    functions,
    targets,
    callers,
    parseErrors: facts.flatMap((f) => (f.error ? [{ file: f.file, error: f.error }] : [])),
  };
}

/** `paths` and `baseUrl` from tsconfig.json or jsconfig.json, so `@/lib/x` can be followed. */
export function readPathAliases(root: string): PathAliases {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let raw: string;
    try {
      raw = readFileSync(path.join(root, name), 'utf8');
    } catch {
      continue;
    }
    try {
      // tsconfig allows comments and trailing commas; JSON.parse does not.
      const json = JSON.parse(
        raw
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/,(\s*[}\]])/g, '$1')
      ) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const options = json.compilerOptions ?? {};
      const baseUrl = options.baseUrl ? path.posix.normalize(options.baseUrl) : null;
      const paths = Object.entries(options.paths ?? {}).map(([key, targets]) => ({
        prefix: key.replace(/\*$/, ''),
        targets: targets.map((target) => path.posix.join(baseUrl ?? '.', target.replace(/\*$/, ''))),
      }));
      return { baseUrl, paths };
    } catch {
      return { baseUrl: null, paths: [] };
    }
  }
  return { baseUrl: null, paths: [] };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function packageName(spec: string): string {
  const bare = spec.replace(/^node:/, '');
  const parts = bare.split('/');
  return bare.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

class Resolver {
  private readonly classesByName = new Map<string, Array<{ file: string; name: string }>>();
  private readonly implementers = new Map<string, Array<{ file: string; name: string }>>();

  constructor(
    private readonly files: Map<string, FileFacts>,
    private readonly functions: Map<string, FlowFunction>,
    private readonly aliases: PathAliases
  ) {
    for (const facts of files.values()) {
      for (const cls of Object.values(facts.classes)) {
        push(this.classesByName, cls.name, { file: facts.file, name: cls.name });
        for (const iface of cls.implements) push(this.implementers, iface, { file: facts.file, name: cls.name });
      }
    }
  }

  resolve(fn: FlowFunction, event: FlowEvent): Target {
    return event.type === 'call' && event.callee ? this.resolveRef(fn, event.callee, 0) : NONE;
  }

  private resolveRef(fn: FlowFunction, callee: CalleeRef, depth: number): Target {
    const facts = this.files.get(fn.file);
    if (!facts || depth > 4) return NONE;
    const owner = this.ownerOf(fn);

    switch (callee.kind) {
      case 'name': {
        const local = this.localFunction(fn, callee.name);
        if (local) return { kind: 'fn', id: local };
        const value = this.nameValue(facts, callee.name, 0);
        if (value) return this.callValue(value);
        const made = this.madeByPackage(fn, callee.name, depth);
        if (made) return this.external(made, callee.name);
        return callee.name === 'fetch' ? this.external('built-in fetch', 'fetch') : NONE;
      }
      case 'this':
        return owner ? this.method(fn.file, owner, callee.name) : NONE;
      case 'super': {
        const parent = owner ? facts.classes[owner]?.extends : null;
        return parent ? this.methodOfType(fn.file, parent, callee.name) : NONE;
      }
      case 'thisField': {
        const type = owner ? facts.classes[owner]?.fields[callee.field] : undefined;
        return type ? this.methodOfType(fn.file, type, callee.name) : NONE;
      }
      case 'member': {
        const type = this.localType(fn, callee.object);
        if (type) return this.methodOfType(fn.file, type, callee.name);
        if (this.localFunction(fn, callee.object)) return NONE;
        const value = this.nameValue(facts, callee.object, 0);
        const member = value ? this.member(value, callee.name, 0) : null;
        if (member) return this.callValue(member);
        const made = this.madeByPackage(fn, callee.object, depth);
        return made ? this.external(made, `${callee.object}.${callee.name}`) : NONE;
      }
    }
  }

  /**
   * `const client = await pool.connect()`: if a package made this value, a call
   * on it is a call into that package too. Returns the package, or null.
   */
  private madeByPackage(fn: FlowFunction, name: string, depth: number): string | null {
    let current: FlowFunction | undefined = fn;
    let ref: CalleeRef | undefined;
    while (current && !ref) {
      ref = current.localResults[name];
      current = current.parent ? this.functions.get(current.parent) : undefined;
    }
    ref ??= this.files.get(fn.file)?.results[name];
    if (!ref) return null;
    const source = this.resolveRef(fn, ref, depth + 1);
    return source.kind === 'external' ? source.module : null;
  }

  // ---------- names inside a function ----------

  /** Arrow functions keep `this`, so a helper inside a method still belongs to its class. */
  private ownerOf(fn: FlowFunction): string | null {
    let current: FlowFunction | undefined = fn;
    while (current) {
      // An Express route's owner is the router variable, not a class.
      const expressRoute = current.kind === 'route' && current.name === current.route;
      if (current.owner && !expressRoute) return current.owner;
      current = current.parent ? this.functions.get(current.parent) : undefined;
    }
    return null;
  }

  private localFunction(fn: FlowFunction, name: string): string | null {
    let current: FlowFunction | undefined = fn;
    while (current) {
      const id = current.localFns[name];
      if (id) return id;
      current = current.parent ? this.functions.get(current.parent) : undefined;
    }
    return null;
  }

  private localType(fn: FlowFunction, name: string): string | null {
    let current: FlowFunction | undefined = fn;
    while (current) {
      const type = current.localTypes[name];
      if (type) return type;
      current = current.parent ? this.functions.get(current.parent) : undefined;
    }
    return null;
  }

  // ---------- values ----------

  private callValue(value: Value): Target {
    if (value.kind === 'fn') return value;
    if (value.kind === 'external') return this.external(value.module, value.name);
    if (value.kind === 'module') {
      // Calling a required module: `module.exports = function () {}`.
      const main = this.exportValue(value.file, 'default', 0);
      return main?.kind === 'fn' ? main : NONE;
    }
    return NONE;
  }

  private nameValue(facts: FileFacts, name: string, depth: number): Value | null {
    if (depth > 12) return null;
    const fnId = facts.locals[name];
    if (fnId) return { kind: 'fn', id: fnId };
    if (facts.classes[name]) return { kind: 'class', file: facts.file, name };
    if (facts.objects[name]) return { kind: 'object', file: facts.file, members: facts.objects[name] };
    if (facts.instances[name]) return { kind: 'instance', file: facts.file, className: facts.instances[name] };
    const imported = facts.imports[name];
    return imported ? this.importValue(facts.file, imported, name, depth + 1) : null;
  }

  private importValue(fromFile: string, ref: ImportRef, localName: string, depth: number): Value | null {
    const mod = this.module(fromFile, ref.source);
    if (!mod) return null;
    if ('external' in mod) {
      const whole = ref.imported === 'default' || ref.imported === '*' || ref.imported === 'module';
      return { kind: 'external', module: mod.external, name: whole ? localName : ref.imported };
    }
    if (ref.imported === '*') return { kind: 'module', file: mod.file };
    if (ref.imported === 'module' || ref.imported === 'default') {
      return this.exportValue(mod.file, 'default', depth) ?? { kind: 'module', file: mod.file };
    }
    return this.exportValue(mod.file, ref.imported, depth);
  }

  private exportValue(file: string, name: string, depth: number): Value | null {
    if (depth > 12) return null;
    const facts = this.files.get(file);
    if (!facts) return null;
    const ref = facts.exports[name];
    if (ref) return this.refValue(facts, ref, depth + 1);
    for (const source of facts.starExports) {
      const mod = this.module(file, source);
      if (!mod || 'external' in mod) continue;
      const found = this.exportValue(mod.file, name, depth + 1);
      if (found) return found;
    }
    return null;
  }

  private refValue(facts: FileFacts, ref: ValueRef, depth: number): Value | null {
    switch (ref.kind) {
      case 'fn':
        return { kind: 'fn', id: ref.id };
      case 'local':
        return this.nameValue(facts, ref.name, depth);
      case 'object':
        return { kind: 'object', file: facts.file, members: ref.members };
      case 'instance':
        return { kind: 'instance', file: facts.file, className: ref.className };
      case 'reexport': {
        const mod = this.module(facts.file, ref.source);
        if (!mod) return null;
        if ('external' in mod) return { kind: 'external', module: mod.external, name: ref.imported };
        return ref.imported === '*' ? { kind: 'module', file: mod.file } : this.exportValue(mod.file, ref.imported, depth + 1);
      }
    }
  }

  private member(value: Value, name: string, depth: number): Value | null {
    switch (value.kind) {
      case 'module':
        return this.exportValue(value.file, name, depth + 1);
      case 'object': {
        const facts = this.files.get(value.file);
        const ref = value.members[name];
        return facts && ref ? this.refValue(facts, ref, depth + 1) : null;
      }
      case 'class': {
        const target = this.method(value.file, value.name, name);
        return target.kind === 'none' ? null : target;
      }
      case 'instance': {
        const target = this.methodOfType(value.file, value.className, name);
        return target.kind === 'none' ? null : target;
      }
      case 'external':
        return { kind: 'external', module: value.module, name: `${value.name}.${name}` };
      case 'fn':
        return null;
    }
  }

  // ---------- classes ----------

  /** A method on a class (following `extends`) or on a plain object like `const api = {...}`. */
  private method(file: string, owner: string, name: string, depth = 0): Target {
    const facts = this.files.get(file);
    const cls = facts?.classes[owner];
    if (cls) {
      const id = cls.methods[name];
      if (id) return { kind: 'fn', id };
      return cls.extends && depth < 6 ? this.methodOfType(file, cls.extends, name, depth + 1) : NONE;
    }
    const ref = facts?.objects[owner]?.[name];
    if (facts && ref) {
      const value = this.refValue(facts, ref, 0);
      return value?.kind === 'fn' ? value : NONE;
    }
    return NONE;
  }

  /** Call `name` on something whose class is `typeName`, as seen from `fromFile`. */
  private methodOfType(fromFile: string, typeName: string, name: string, depth = 0): Target {
    const cls = this.findClass(fromFile, typeName);
    if (!cls) return NONE;
    if ('external' in cls) return this.external(cls.external, `${typeName}.${name}`);
    return this.method(cls.file, cls.name, name, depth);
  }

  private findClass(fromFile: string, name: string): ClassRef | null {
    const facts = this.files.get(fromFile);
    if (facts?.classes[name]) return { file: fromFile, name };

    const imported = facts?.imports[name];
    if (imported) {
      const value = this.importValue(fromFile, imported, name, 1);
      if (value?.kind === 'class') return { file: value.file, name: value.name };
      if (value?.kind === 'external') return { external: value.module };
    }

    // An interface, or a class from a file that was not imported by name:
    // follow it only when exactly one class in the project matches.
    const same = this.classesByName.get(name) ?? [];
    if (same.length === 1) return same[0];
    const implementations = this.implementers.get(name) ?? [];
    if (implementations.length === 1) return implementations[0];
    return null;
  }

  // ---------- files ----------

  private module(fromFile: string, spec: string): { file: string } | { external: string } | null {
    if (spec.startsWith('.')) {
      const found = this.findFile(path.posix.join(path.posix.dirname(fromFile), spec));
      return found ? { file: found } : null;
    }
    for (const alias of this.aliases.paths) {
      if (!spec.startsWith(alias.prefix)) continue;
      for (const target of alias.targets) {
        const found = this.findFile(path.posix.join(target, spec.slice(alias.prefix.length)));
        if (found) return { file: found };
      }
    }
    if (this.aliases.baseUrl !== null) {
      const found = this.findFile(path.posix.join(this.aliases.baseUrl, spec));
      if (found) return { file: found };
    }
    return { external: packageName(spec) };
  }

  /** `./ticket.service.js` may be ticket.service.ts on disk; `./lib` may be lib/index.ts. */
  private findFile(base: string): string | null {
    const clean = path.posix.normalize(base).replace(/^\.\//, '');
    if (this.files.has(clean)) return clean;
    const stem = clean.replace(/\.(js|jsx|mjs|cjs)$/, '');
    for (const ext of TRY_EXTENSIONS) if (this.files.has(stem + ext)) return stem + ext;
    for (const ext of TRY_EXTENSIONS) if (this.files.has(`${stem}/index${ext}`)) return `${stem}/index${ext}`;
    return null;
  }

  private external(module: string, name: string): Target {
    if (QUIET_MODULES.has(module)) return NONE;
    if (QUIET_NAMES.test(name.split('.').pop() ?? '')) return NONE;
    return { kind: 'external', module, name };
  }
}

// ---------- asking the project questions ----------

export function summarise(project: FlowProject, fn: FlowFunction): FunctionSummary {
  const targets = project.targets.get(fn.id) ?? [];
  const shown = displayName(fn);
  return {
    id: fn.id,
    label: fn.owner && !fn.route ? `${fn.owner}.${shown}` : shown,
    name: fn.name,
    owner: fn.owner,
    route: fn.route,
    kind: fn.kind,
    file: fn.file,
    line: fn.line,
    calls: targets.filter((t) => t.kind !== 'none').length,
    calledBy: (project.callers.get(fn.id) ?? []).length,
  };
}

export function searchFunctions(project: FlowProject, query: string, limit = 30): FunctionSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: Array<{ fn: FlowFunction; score: number }> = [];
  for (const fn of project.functions.values()) {
    const name = fn.name.toLowerCase();
    const owned = fn.owner ? `${fn.owner}.${fn.name}`.toLowerCase() : '';
    let score = 0;
    if (name === q || owned === q) score = 100;
    else if (name.startsWith(q)) score = 70;
    else if (name.includes(q) || owned.includes(q)) score = 40;
    else if ((fn.route ?? '').toLowerCase().includes(q)) score = 35;
    else if (fn.file.toLowerCase().includes(q)) score = 12;
    if (score > 0) scored.push({ fn, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (project.callers.get(b.fn.id)?.length ?? 0) - (project.callers.get(a.fn.id)?.length ?? 0) ||
      a.fn.name.localeCompare(b.fn.name)
  );
  return scored.slice(0, limit).map(({ fn }) => summarise(project, fn));
}

/**
 * Good places to start reading: routes, and functions nothing else in the
 * project calls but that lead somewhere. This is for finding your way around,
 * not a ranking of what matters.
 */
export function flowStarts(project: FlowProject): { routes: FunctionSummary[]; others: FunctionSummary[] } {
  const reach = (fn: FlowFunction): number =>
    new Set((project.targets.get(fn.id) ?? []).flatMap((t) => (t.kind === 'fn' ? [t.id] : []))).size;
  const all = [...project.functions.values()];

  const routes = all
    .filter((fn) => fn.kind === 'route')
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const others = all
    .filter((fn) => fn.kind !== 'route' && !(project.callers.get(fn.id) ?? []).length && reach(fn) > 0)
    .sort((a, b) => reach(b) - reach(a) || a.file.localeCompare(b.file) || a.line - b.line);

  return {
    routes: routes.slice(0, 60).map((fn) => summarise(project, fn)),
    others: others.slice(0, 16).map((fn) => summarise(project, fn)),
  };
}
