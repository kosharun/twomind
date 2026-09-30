import path from 'node:path';
import { parse, type ParserPlugin } from '@babel/parser';
import type * as t from '@babel/types';
import { GENERIC_FLOW_EXTENSIONS, readGenericFlowFacts } from './generic.js';
import type { ArmRef, BranchKind, CalleeRef, FlowArm, FlowBranch, FlowFunction, FunctionKind } from './types.js';

/**
 * Read one JS or TS file into flow facts: its functions, what each one calls
 * or throws, and under which condition (a switch case, an if, a try).
 *
 * This is a real parse, not a text search, because a flow has to know which
 * `if` a call sits inside. It reads one file at a time and knows nothing about
 * the others. resolve.ts connects the files.
 */

const BABEL_FLOW_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
export const FLOW_EXTENSIONS = new Set([...BABEL_FLOW_EXTENSIONS, ...GENERIC_FLOW_EXTENSIONS]);

/** A name brought in from another file. */
export interface ImportRef {
  source: string;
  /** A name, or 'default', '*' (a namespace) or 'module' (a CommonJS require). */
  imported: string;
}

/** What a file-level or exported name points to. */
export type ValueRef =
  | { kind: 'fn'; id: string }
  | { kind: 'local'; name: string }
  | { kind: 'object'; members: Record<string, ValueRef> }
  | { kind: 'instance'; className: string }
  | { kind: 'reexport'; source: string; imported: string };

export interface ClassFacts {
  name: string;
  line: number;
  /** Method name -> function id. */
  methods: Record<string, string>;
  /** Field name -> class or type name, from a TS type or `this.x = new X()`. */
  fields: Record<string, string>;
  extends: string | null;
  implements: string[];
}

export interface FileFacts {
  file: string;
  functions: FlowFunction[];
  /** Top-level function name -> id. */
  locals: Record<string, string>;
  classes: Record<string, ClassFacts>;
  /** `const api = { login() {} }`: object name -> its members. */
  objects: Record<string, Record<string, ValueRef>>;
  /** `const repo = new Repo()` at the top level: name -> class name. */
  instances: Record<string, string>;
  /** `const db = createClient()` at the top level: name -> the call that made it. */
  results: Record<string, CalleeRef>;
  imports: Record<string, ImportRef>;
  exports: Record<string, ValueRef>;
  /** `export * from './x'` */
  starExports: string[];
  /** Set when the file could not be parsed at all. */
  error: string | null;
}

type InlineFunction = t.FunctionExpression | t.ArrowFunctionExpression;
type AnyFunction = t.FunctionDeclaration | InlineFunction | t.ObjectMethod | t.ClassMethod | t.ClassPrivateMethod;

interface WalkState {
  /** The function that calls found here belong to. */
  fn: FlowFunction;
  cls: ClassFacts | null;
  path: ArmRef[];
  context: string[];
}

interface OpenBranch {
  index: number;
  branch: FlowBranch;
}

/** Calls on these are plumbing, not flow. Nobody wants `console.log` on a map. */
const GLOBAL_OBJECTS = new Set([
  'console', 'JSON', 'Math', 'Object', 'Array', 'Number', 'String', 'Boolean', 'Promise', 'Date',
  'Reflect', 'Symbol', 'Buffer', 'process', 'window', 'document', 'globalThis', 'localStorage',
  'sessionStorage', 'navigator', 'Intl', 'URL', 'URLSearchParams', 'Error',
]);

const GLOBAL_FUNCTIONS = new Set([
  'require', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'structuredClone', 'alert', 'confirm',
]);

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'del', 'all', 'use', 'options', 'head']);

/** What servers and routers are made with: `const router = Router()`, `const app = express()`. */
const ROUTER_MAKERS = /^(express|Router|createRouter|Hono|Koa|Elysia|fastify|polka)$/;

/** Names that are usually HTTP clients, whose `.post('/x', body)` sends a request instead. */
const HTTP_CLIENTS = /^(api|axios|http|https|client|request|fetcher|ky|superagent|instance)$/i;

/** NestJS-style route decorators: `@Post('status')`. */
const ROUTE_DECORATORS: Record<string, string> = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', All: 'ALL',
};

/** Keys that hold types, positions or comments: never code that runs. */
const SKIP_KEYS = new Set([
  'loc', 'start', 'end', 'extra', 'range', 'leadingComments', 'trailingComments', 'innerComments',
  'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'superTypeParameters',
  'decorators', 'implements',
]);

export function readFlowFacts(file: string, text: string): FileFacts {
  if (GENERIC_FLOW_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    return readGenericFlowFacts(file, text);
  }
  return new Extractor(file, text).run();
}

// ---------- small helpers ----------

const isNode = (value: unknown): value is t.Node =>
  !!value && typeof (value as { type?: unknown }).type === 'string';

const startOf = (node: t.Node): number => node.start ?? 0;
const endOf = (node: t.Node): number => node.end ?? 0;
const lineOf = (node: t.Node): number => node.loc?.start.line ?? 0;
const endLineOf = (node: t.Node): number => node.loc?.end.line ?? 0;

function isInlineFunction(node: t.Node | null | undefined): node is InlineFunction {
  return !!node && (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression');
}

/** Look through `x as T`, `x!` and `(x)` to the expression itself. */
function unwrap(node: t.Node): t.Node {
  let current = node;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion' ||
    current.type === 'ParenthesizedExpression'
  ) {
    current = current.expression;
  }
  return current;
}

function keyName(key: t.Node): string | null {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  if (key.type === 'NumericLiteral') return String(key.value);
  if (key.type === 'PrivateName') return `#${key.id.name}`;
  return null;
}

function propertyName(member: t.MemberExpression | t.OptionalMemberExpression): string | null {
  if (member.computed && member.property.type !== 'StringLiteral') return null;
  return keyName(member.property);
}

function stringValue(node: t.Node | null | undefined): string | null {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? '').join('');
  }
  return null;
}

/** The class name in a TS annotation like `repo: TicketRepository<T>`. */
function typeName(annotation: t.Node | null | undefined): string | null {
  if (!annotation || annotation.type !== 'TSTypeAnnotation') return null;
  const type = annotation.typeAnnotation;
  if (type.type !== 'TSTypeReference') return null;
  if (type.typeName.type === 'Identifier') return type.typeName.name;
  if (type.typeName.type === 'TSQualifiedName') return type.typeName.right.name;
  return null;
}

/** The name in `implements Repo`, for both shapes Babel uses. */
function implementedName(node: t.Node): string | null {
  const inner = (node as { expression?: t.Node; id?: t.Node }).expression ?? (node as { id?: t.Node }).id;
  if (!inner) return null;
  if (inner.type === 'Identifier') return inner.name;
  if (inner.type === 'TSQualifiedName') return inner.right.name;
  return null;
}

/** The call behind `await x()` or `x()`, if that is what a value is. */
function callIn(node: t.Node | null | undefined): t.CallExpression | t.OptionalCallExpression | null {
  if (!node) return null;
  let inner = unwrap(node);
  if (inner.type === 'AwaitExpression' && inner.argument) inner = unwrap(inner.argument);
  return inner.type === 'CallExpression' || inner.type === 'OptionalCallExpression' ? inner : null;
}

/** `require('x')` -> 'x' */
function requireSource(node: t.Node | null | undefined): string | null {
  if (!node || node.type !== 'CallExpression') return null;
  if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return null;
  return stringValue(node.arguments[0]);
}

/** `module.exports` -> 'default', `exports.foo` or `module.exports.foo` -> 'foo'. */
function commonJsExportName(left: t.Node): string | null {
  if (left.type !== 'MemberExpression') return null;
  const prop = propertyName(left);
  const obj = left.object;
  if (obj.type === 'Identifier' && obj.name === 'module' && prop === 'exports') return 'default';
  if (obj.type === 'Identifier' && obj.name === 'exports' && prop) return prop;
  if (
    obj.type === 'MemberExpression' &&
    obj.object.type === 'Identifier' &&
    obj.object.name === 'module' &&
    propertyName(obj) === 'exports' &&
    prop
  ) {
    return prop;
  }
  return null;
}

/** True when this code always ends the function: its last statement returns or throws. */
function endsFunction(node: t.Node | null | undefined): boolean {
  if (!node) return false;
  if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement') return true;
  if (node.type === 'BlockStatement') return endsFunction(node.body[node.body.length - 1]);
  if (node.type === 'IfStatement') {
    return !!node.alternate && endsFunction(node.consequent) && endsFunction(node.alternate);
  }
  return false;
}

/** How a call names its target, or null when the call is plumbing. */
function calleeRef(node: t.Node): CalleeRef | null {
  const callee = unwrap(node);
  if (callee.type === 'Identifier') {
    return GLOBAL_FUNCTIONS.has(callee.name) ? null : { kind: 'name', name: callee.name };
  }
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return null;

  const name = propertyName(callee);
  if (!name) return null;
  const object = unwrap(callee.object);

  if (object.type === 'ThisExpression') return { kind: 'this', name };
  if (object.type === 'Super') return { kind: 'super', name };
  if (object.type === 'Identifier') {
    return GLOBAL_OBJECTS.has(object.name) ? null : { kind: 'member', object: object.name, name };
  }
  if (
    (object.type === 'MemberExpression' || object.type === 'OptionalMemberExpression') &&
    unwrap(object.object).type === 'ThisExpression'
  ) {
    const field = propertyName(object);
    return field ? { kind: 'thisField', field, name } : null;
  }
  return null;
}

/**
 * The function behind a name: `x = () => {}`, or a wrapper that takes the
 * function first, like `useCallback(fn, deps)` or `asyncHandler(fn)`.
 * `items.map(fn)` is not a wrapper: its callback runs right there.
 */
function functionIn(node: t.Node | null | undefined): InlineFunction | null {
  if (!node) return null;
  const inner = unwrap(node);
  if (isInlineFunction(inner)) return inner;
  if (
    inner.type === 'CallExpression' &&
    inner.callee.type === 'Identifier' &&
    !GLOBAL_FUNCTIONS.has(inner.callee.name)
  ) {
    const first = inner.arguments[0];
    return isInlineFunction(first) ? first : null;
  }
  return null;
}

function pluginsFor(file: string): ParserPlugin[] {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.tsx') return ['typescript', 'jsx', 'decorators-legacy'];
  // No JSX in .ts: it would misread generic arrow functions like <T>(x: T) => x.
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return ['typescript', 'decorators-legacy'];
  return ['jsx', 'decorators-legacy'];
}

function joinRoute(...parts: string[]): string {
  const joined = parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  return `/${joined}`;
}

/** `@Controller('tickets')` -> 'tickets' */
function controllerPrefix(decorators: t.Decorator[] | null | undefined): string {
  for (const decorator of decorators ?? []) {
    const expr = decorator.expression;
    if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier' && expr.callee.name === 'Controller') {
      return stringValue(expr.arguments[0]) ?? '';
    }
  }
  return '';
}

/** `@Post(':id/status')` inside `@Controller('tickets')` -> 'POST /tickets/:id/status' */
function decoratorRoute(decorators: t.Decorator[] | null | undefined, prefix: string): string | null {
  for (const decorator of decorators ?? []) {
    const expr = decorator.expression;
    const callee = expr.type === 'CallExpression' ? expr.callee : expr;
    if (callee.type !== 'Identifier' || !(callee.name in ROUTE_DECORATORS)) continue;
    const routePath = expr.type === 'CallExpression' ? stringValue(expr.arguments[0]) ?? '' : '';
    return `${ROUTE_DECORATORS[callee.name]} ${joinRoute(prefix, routePath)}`;
  }
  return null;
}

// ---------- the extractor ----------

class Extractor {
  private readonly facts: FileFacts;
  private readonly usedIds = new Set<string>();
  /** Code that runs when the file loads. Scripts and servers often start here. */
  private readonly moduleFn: FlowFunction;
  private readonly moduleState: WalkState;

  constructor(
    private readonly file: string,
    private readonly text: string
  ) {
    this.facts = {
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
    this.moduleFn = this.newFunction(null, '(top level)', null, 'function', false, null, false);
    this.moduleState = { fn: this.moduleFn, cls: null, path: [], context: [] };
  }

  run(): FileFacts {
    let program: t.Program;
    try {
      program = parse(this.text, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowSuperOutsideMethod: true,
        allowUndeclaredExports: true,
        plugins: pluginsFor(this.file),
      }).program;
    } catch (error) {
      this.facts.error = error instanceof Error ? error.message : String(error);
      return this.facts;
    }

    for (const statement of program.body) this.topLevel(statement);

    if (this.moduleFn.events.length) {
      this.moduleFn.endLine = endLineOf(program);
      this.facts.functions.unshift(this.moduleFn);
    }
    for (const fn of this.facts.functions) fn.events.sort((a, b) => a.at - b.at);
    return this.facts;
  }

  // ---------- the top of the file ----------

  private topLevel(node: t.Statement): void {
    switch (node.type) {
      case 'ImportDeclaration':
        this.importDeclaration(node);
        return;
      case 'ExportNamedDeclaration':
        this.exportNamed(node);
        return;
      case 'ExportDefaultDeclaration':
        this.exportDefault(node);
        return;
      case 'ExportAllDeclaration':
        this.facts.starExports.push(node.source.value);
        return;
      case 'FunctionDeclaration':
        this.functionDeclaration(node, false);
        return;
      case 'ClassDeclaration':
        this.classDeclaration(node, false);
        return;
      case 'VariableDeclaration':
        this.variableDeclaration(node, false);
        return;
      case 'TSExportAssignment':
        this.commonJsExport('default', node.expression);
        return;
      case 'TSModuleDeclaration':
        if (node.body.type === 'TSModuleBlock') node.body.body.forEach((statement) => this.topLevel(statement));
        return;
      case 'ExpressionStatement': {
        const expr = node.expression;
        if (expr.type === 'AssignmentExpression' && expr.operator === '=') {
          const name = commonJsExportName(expr.left);
          if (name) {
            this.commonJsExport(name, expr.right);
            return;
          }
        }
        this.walk(node, this.moduleState);
        return;
      }
      default:
        this.walk(node, this.moduleState);
    }
  }

  private importDeclaration(node: t.ImportDeclaration): void {
    // Type-only imports are kept too: `repo: TicketRepository` needs them.
    const source = node.source.value;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') {
        this.facts.imports[spec.local.name] = { source, imported: 'default' };
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        this.facts.imports[spec.local.name] = { source, imported: '*' };
      } else {
        const imported = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
        this.facts.imports[spec.local.name] = { source, imported };
      }
    }
  }

  private exportNamed(node: t.ExportNamedDeclaration): void {
    const decl = node.declaration;
    if (decl?.type === 'FunctionDeclaration') {
      const fn = this.functionDeclaration(decl, true);
      if (fn) this.facts.exports[fn.name] = { kind: 'fn', id: fn.id };
    } else if (decl?.type === 'ClassDeclaration') {
      const cls = this.classDeclaration(decl, true);
      if (cls) this.facts.exports[cls.name] = { kind: 'local', name: cls.name };
    } else if (decl?.type === 'VariableDeclaration') {
      this.variableDeclaration(decl, true);
    } else if (decl?.type === 'TSModuleDeclaration') {
      this.topLevel(decl);
    }

    for (const spec of node.specifiers) {
      const exported = spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value;
      if (spec.type === 'ExportSpecifier') {
        this.facts.exports[exported] = node.source
          ? { kind: 'reexport', source: node.source.value, imported: spec.local.name }
          : { kind: 'local', name: spec.local.name };
      } else if (node.source) {
        const imported = spec.type === 'ExportNamespaceSpecifier' ? '*' : 'default';
        this.facts.exports[exported] = { kind: 'reexport', source: node.source.value, imported };
      }
    }
  }

  private exportDefault(node: t.ExportDefaultDeclaration): void {
    const decl = node.declaration;
    if (decl.type === 'FunctionDeclaration') {
      const fn = this.functionDeclaration(decl, true, this.fileLabel());
      if (fn) this.facts.exports.default = { kind: 'fn', id: fn.id };
    } else if (decl.type === 'ClassDeclaration' || decl.type === 'ClassExpression') {
      const cls = this.classDeclaration(decl, true, this.fileLabel());
      if (cls) this.facts.exports.default = { kind: 'local', name: cls.name };
    } else if (decl.type !== 'TSDeclareFunction') {
      this.commonJsExport('default', decl);
    }
  }

  /** `module.exports = ...` and `export default ...` take the same shapes. */
  private commonJsExport(name: string, node: t.Node): void {
    const value = unwrap(node);

    const fnNode = functionIn(value);
    if (fnNode) {
      const ownName = fnNode.type === 'FunctionExpression' && fnNode.id ? fnNode.id.name : null;
      const fnName = name === 'default' ? ownName ?? this.fileLabel() : name;
      const fn = this.newFunction(fnNode, fnName, null, 'function', true, null);
      this.facts.exports[name] = { kind: 'fn', id: fn.id };
      if (name !== 'default') this.facts.locals[name] ??= fn.id;
      this.walkFunction(fnNode, fn, null);
      return;
    }

    if (value.type === 'Identifier') {
      this.facts.exports[name] = { kind: 'local', name: value.name };
    } else if (value.type === 'ObjectExpression') {
      const members = this.objectMembers(value, null, true);
      this.facts.exports[name] = { kind: 'object', members };
      // `module.exports = { login, logout }` also makes each one importable by name.
      if (name === 'default') {
        for (const [key, ref] of Object.entries(members)) this.facts.exports[key] ??= ref;
      }
    } else if (value.type === 'NewExpression' && value.callee.type === 'Identifier') {
      this.facts.exports[name] = { kind: 'instance', className: value.callee.name };
      this.walk(value, this.moduleState);
    } else if (value.type === 'ClassExpression') {
      const cls = this.classDeclaration(value, true, name === 'default' ? this.fileLabel() : name);
      if (cls) this.facts.exports[name] = { kind: 'local', name: cls.name };
    } else {
      this.walk(value, this.moduleState);
    }
  }

  private functionDeclaration(
    node: t.FunctionDeclaration,
    exported: boolean,
    fallbackName?: string
  ): FlowFunction | null {
    const name = node.id?.name ?? fallbackName;
    if (!name) return null;
    const fn = this.newFunction(node, name, null, 'function', exported, null);
    if (node.id) this.facts.locals[node.id.name] ??= fn.id;
    this.walkFunction(node, fn, null);
    return fn;
  }

  private variableDeclaration(node: t.VariableDeclaration, exported: boolean): void {
    for (const declarator of node.declarations) {
      const id = declarator.id;
      const init = declarator.init ? unwrap(declarator.init) : null;

      // const { hash, compare } = require('./hash')
      if (id.type === 'ObjectPattern') {
        const source = requireSource(init);
        if (!source) {
          if (declarator.init) this.walk(declarator.init, this.moduleState);
          continue;
        }
        for (const prop of id.properties) {
          if (prop.type !== 'ObjectProperty' || prop.value.type !== 'Identifier') continue;
          const imported = keyName(prop.key);
          if (imported) this.facts.imports[prop.value.name] = { source, imported };
        }
        continue;
      }

      if (id.type !== 'Identifier') {
        if (declarator.init) this.walk(declarator.init, this.moduleState);
        continue;
      }

      const name = id.name;
      if (exported) this.facts.exports[name] = { kind: 'local', name };
      if (!init) continue;

      const source = requireSource(init);
      if (source) {
        this.facts.imports[name] = { source, imported: 'module' };
        continue;
      }
      // const hash = require('./hash').hash
      if (init.type === 'MemberExpression' && requireSource(init.object)) {
        const member = propertyName(init);
        if (member) {
          this.facts.imports[name] = { source: requireSource(init.object) ?? '', imported: member };
          continue;
        }
      }

      const fnNode = functionIn(init);
      if (fnNode) {
        const fn = this.newFunction(fnNode, name, null, 'function', exported, null);
        this.facts.locals[name] ??= fn.id;
        this.walkFunction(fnNode, fn, null);
        continue;
      }

      if (init.type === 'ClassExpression') {
        this.classDeclaration(init, exported, name, true);
      } else if (init.type === 'NewExpression' && init.callee.type === 'Identifier') {
        this.facts.instances[name] = init.callee.name;
        this.walk(init, this.moduleState);
      } else if (init.type === 'ObjectExpression') {
        this.facts.objects[name] = this.objectMembers(init, name, exported);
      } else {
        const call = callIn(init);
        const ref = call ? calleeRef(call.callee) : null;
        if (ref) this.facts.results[name] = ref;
        this.walk(init, this.moduleState);
      }
    }
  }

  private objectMembers(
    node: t.ObjectExpression,
    owner: string | null,
    exported: boolean
  ): Record<string, ValueRef> {
    const members: Record<string, ValueRef> = {};
    const kind: FunctionKind = owner ? 'method' : 'function';

    for (const prop of node.properties) {
      if (prop.type === 'ObjectMethod') {
        const key = keyName(prop.key);
        if (!key || prop.kind !== 'method') continue;
        const fn = this.newFunction(prop, key, owner, kind, exported, null);
        members[key] = { kind: 'fn', id: fn.id };
        this.walkFunction(prop, fn, null);
      } else if (prop.type === 'ObjectProperty') {
        const key = keyName(prop.key);
        if (!key) continue;
        const value = unwrap(prop.value);
        const fnNode = functionIn(value);
        if (fnNode) {
          const fn = this.newFunction(fnNode, key, owner, kind, exported, null);
          members[key] = { kind: 'fn', id: fn.id };
          this.walkFunction(fnNode, fn, null);
        } else if (value.type === 'Identifier') {
          members[key] = { kind: 'local', name: value.name };
        } else {
          this.walk(value, this.moduleState);
        }
      }
    }
    return members;
  }

  private classDeclaration(
    node: t.ClassDeclaration | t.ClassExpression,
    exported: boolean,
    fallbackName?: string,
    preferFallback = false
  ): ClassFacts | null {
    const name = preferFallback ? fallbackName : node.id?.name ?? fallbackName;
    if (!name) return null;

    const cls: ClassFacts = {
      name,
      line: lineOf(node),
      methods: {},
      fields: {},
      extends: node.superClass?.type === 'Identifier' ? node.superClass.name : null,
      implements: (node.implements ?? []).map(implementedName).filter((n): n is string => !!n),
    };
    this.facts.classes[name] ??= cls;
    const prefix = controllerPrefix(node.decorators);

    for (const member of node.body.body) {
      if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
        if (member.kind === 'get' || member.kind === 'set') continue;
        const methodName = keyName(member.key);
        if (!methodName) continue;
        const fn = this.newFunction(member, methodName, name, 'method', exported, null);
        const route = decoratorRoute(member.decorators, prefix);
        if (route) {
          fn.kind = 'route';
          fn.route = route;
        }
        cls.methods[methodName] = fn.id;
        if (methodName === 'constructor') this.constructorFields(member, cls);
        this.walkFunction(member, fn, cls);
      } else if (member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty') {
        const fieldName = keyName(member.key);
        if (!fieldName) continue;
        const declared = typeName(member.typeAnnotation);
        if (declared) cls.fields[fieldName] = declared;

        const value = member.value ? unwrap(member.value) : null;
        const fnNode = functionIn(value);
        if (fnNode) {
          const fn = this.newFunction(fnNode, fieldName, name, 'method', exported, null);
          cls.methods[fieldName] = fn.id;
          this.walkFunction(fnNode, fn, cls);
        } else if (value?.type === 'NewExpression' && value.callee.type === 'Identifier') {
          cls.fields[fieldName] = value.callee.name;
        }
      }
    }
    return cls;
  }

  /** `constructor(private repo: Repo)` and `this.repo = new Repo()` both tell us what `this.repo` is. */
  private constructorFields(ctor: t.ClassMethod | t.ClassPrivateMethod, cls: ClassFacts): void {
    const paramTypes: Record<string, string> = {};
    for (const param of ctor.params) {
      const info = this.param(param);
      if (!info.type) continue;
      paramTypes[info.name] = info.type;
      if (param.type === 'TSParameterProperty') cls.fields[info.name] = info.type;
    }

    for (const statement of ctor.body.body) {
      if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'AssignmentExpression') continue;
      const { left, right } = statement.expression;
      if (left.type !== 'MemberExpression' || left.object.type !== 'ThisExpression') continue;
      const field = propertyName(left);
      if (!field) continue;
      const value = unwrap(right);
      if (value.type === 'NewExpression' && value.callee.type === 'Identifier') {
        cls.fields[field] = value.callee.name;
      } else if (value.type === 'Identifier' && paramTypes[value.name]) {
        cls.fields[field] = paramTypes[value.name];
      }
    }
  }

  // ---------- inside a function ----------

  private walkFunction(node: AnyFunction, fn: FlowFunction, cls: ClassFacts | null): void {
    this.walk(node.body, { fn, cls, path: [], context: [] });
  }

  private walk(node: t.Node | null | undefined, st: WalkState): void {
    if (!node) return;
    switch (node.type) {
      case 'FunctionDeclaration':
        if (node.id) this.nestedFunction(node, node.id.name, st);
        return;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        this.inline(node, st, 'in a callback');
        return;
      case 'ClassDeclaration':
      case 'ClassExpression':
        this.classDeclaration(node, false);
        return;
      case 'VariableDeclarator':
        this.localDeclarator(node, st);
        return;
      case 'CallExpression':
      case 'OptionalCallExpression':
        this.call(node, st);
        return;
      case 'ThrowStatement':
        this.throwStatement(node, st);
        return;
      case 'IfStatement':
        this.ifStatement(node, st);
        return;
      case 'SwitchStatement':
        this.switchStatement(node, st);
        return;
      case 'ConditionalExpression':
        this.ternary(node, st);
        return;
      case 'TryStatement':
        this.tryStatement(node, st);
        return;
      case 'ForOfStatement':
      case 'ForInStatement':
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
        this.loop(node, st);
        return;
      case 'JSXAttribute':
        this.jsxAttribute(node, st);
        return;
      default:
        this.children(node, st);
    }
  }

  private children(node: t.Node, st: WalkState): void {
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) this.walk(item, st);
      } else if (isNode(value)) {
        this.walk(value, st);
      }
    }
  }

  /** A named function declared inside another one gets a box of its own. */
  private nestedFunction(node: t.FunctionDeclaration | InlineFunction, name: string, st: WalkState): void {
    const atTop = st.fn === this.moduleFn;
    const fn = this.newFunction(node, name, null, 'function', false, atTop ? null : st.fn);
    if (atTop) this.facts.locals[name] ??= fn.id;
    else st.fn.localFns[name] ??= fn.id;
    this.walkFunction(node, fn, st.cls);
  }

  /** An anonymous callback runs as part of the function around it. */
  private inline(node: InlineFunction, st: WalkState, label: string): void {
    this.walk(node.body, { ...st, context: [...st.context, label] });
  }

  private localDeclarator(node: t.VariableDeclarator, st: WalkState): void {
    if (node.id.type === 'Identifier') {
      const name = node.id.name;
      const declared = typeName(node.id.typeAnnotation);
      if (declared) st.fn.localTypes[name] = declared;

      const init = node.init ? unwrap(node.init) : null;
      if (init?.type === 'NewExpression' && init.callee.type === 'Identifier') {
        st.fn.localTypes[name] = init.callee.name;
      }

      const fnNode = functionIn(init);
      if (fnNode) {
        this.nestedFunction(fnNode, name, st);
        // useCallback(fn, deps): the other arguments still run here.
        if (init && init !== fnNode && init.type === 'CallExpression') {
          for (const arg of init.arguments.slice(1)) this.walk(arg, st);
        }
        return;
      }

      const call = callIn(init);
      const ref = call ? calleeRef(call.callee) : null;
      if (ref) st.fn.localResults[name] = ref;
    }
    this.walk(node.init, st);
  }

  private call(node: t.CallExpression | t.OptionalCallExpression, st: WalkState): void {
    if (this.routeRegistration(node)) return;

    // The callee first: in `a().b()`, a() finishes before b() starts.
    this.walk(node.callee, st);
    const calleeText = this.short(node.callee, 40);
    for (const arg of node.arguments) {
      if (isInlineFunction(arg)) this.inline(arg, st, `in ${calleeText}()`);
      else this.walk(arg, st);
    }

    const callee = calleeRef(node.callee);
    if (!callee) return;
    st.fn.events.push({
      type: 'call',
      at: endOf(node),
      line: this.calleeLine(node.callee),
      text: `${calleeText}()`,
      callee,
      path: [...st.path],
      context: [...st.context],
    });
  }

  /** `router.post('/orders', auth, async (req, res) => {...})` becomes one "POST /orders" function. */
  private routeRegistration(node: t.CallExpression | t.OptionalCallExpression): boolean {
    const callee = node.callee;
    if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return false;
    const method = callee.property.name.toLowerCase();
    if (!HTTP_METHODS.has(method)) return false;

    const [first, ...handlers] = node.arguments;
    const routePath = stringValue(first);
    if (!routePath?.startsWith('/') || handlers.length === 0) return false;

    // `api.post('/login', body)` in a React app sends a request; it is not a route.
    // A route has a handler function, or is registered on something made as a router.
    const owner = callee.object.type === 'Identifier' ? callee.object.name : null;
    const hasHandler = handlers.some(isInlineFunction);
    if (!this.isRouter(owner) && !(hasHandler && !HTTP_CLIENTS.test(owner ?? ''))) return false;

    const label = `${method === 'del' ? 'DELETE' : method.toUpperCase()} ${routePath}`;
    const fn = this.newFunction(node, label, owner, 'route', false, null);
    fn.route = label;
    const st: WalkState = { fn, cls: null, path: [], context: [] };

    for (const handler of handlers) {
      if (isInlineFunction(handler)) {
        if (!fn.params.length) fn.params = handler.params.map((p) => this.param(p).name);
        this.walk(handler.body, st);
      } else if (handler.type === 'CallExpression') {
        // validate(schema): a middleware made by calling a function.
        this.call(handler, st);
      } else {
        // A named middleware or handler: Express calls it, so the route does.
        const ref = calleeRef(handler);
        if (ref) {
          fn.events.push({
            type: 'call',
            at: endOf(handler),
            line: lineOf(handler),
            text: `${this.short(handler, 40)}()`,
            callee: ref,
            path: [],
            context: [],
          });
        }
      }
    }
    return true;
  }

  private isRouter(name: string | null): boolean {
    if (!name) return false;
    if (/^(app|server)$|router$/i.test(name)) return true;
    const made = this.facts.results[name];
    const maker = made?.kind === 'member' ? made.name : made?.kind === 'name' ? made.name : null;
    return (maker !== null && ROUTER_MAKERS.test(maker)) || ROUTER_MAKERS.test(this.facts.instances[name] ?? '');
  }

  private throwStatement(node: t.ThrowStatement, st: WalkState): void {
    this.walk(node.argument, st);
    st.fn.events.push({
      type: 'throw',
      at: endOf(node),
      line: lineOf(node),
      text: this.thrownText(node.argument),
      path: [...st.path],
      context: [...st.context],
    });
  }

  private ifStatement(node: t.IfStatement, st: WalkState): void {
    // `if / else if / else` is one choice with many arms, not a tree of yes/no.
    const links: t.IfStatement[] = [node];
    let rest: t.Statement | null | undefined = node.alternate;
    while (rest?.type === 'IfStatement') {
      links.push(rest);
      rest = rest.alternate;
    }

    for (const link of links) this.walk(link.test, st);
    const bodies: Array<t.Node | null> = [...links.map((link) => link.consequent), rest ?? null];
    if (!this.matters(bodies)) {
      for (const body of bodies) this.walk(body, st);
      return;
    }

    const single = links.length === 1;
    const labels = single ? ['yes', 'no'] : [...links.map((link) => this.short(link.test, 48)), 'none of them'];
    const open = this.openBranch(
      st,
      single ? 'if' : 'if-chain',
      single ? this.short(node.test, 60) : 'which one is true',
      node
    );
    bodies.forEach((body, i) => this.arm(open, st, labels[i], body));
  }

  private switchStatement(node: t.SwitchStatement, st: WalkState): void {
    this.walk(node.discriminant, st);
    if (!this.matters(node.cases)) {
      for (const c of node.cases) this.children(c, st);
      return;
    }

    const open = this.openBranch(st, 'switch', this.short(node.discriminant, 48), node);
    // `case A: case B: work()` is one arm: an empty case falls into the next one.
    let labels: string[] = [];
    let value: string | undefined;
    let firstLine = 0;
    for (const c of node.cases) {
      const caseValue = c.test ? this.caseValue(c.test) : null;
      labels.push(caseValue === null ? 'default' : `case ${caseValue}`);
      if (value === undefined && caseValue !== null) value = caseValue;
      firstLine ||= lineOf(c);
      if (c.consequent.length === 0) continue;
      this.arm(open, st, labels.join(' / '), c.consequent, { value, line: firstLine });
      labels = [];
      value = undefined;
      firstLine = 0;
    }
    if (labels.length) {
      open.branch.arms.push({ label: labels.join(' / '), value, line: firstLine, endLine: firstLine, exits: false });
    }
    if (!node.cases.some((c) => !c.test)) {
      open.branch.arms.push({ label: 'no match', line: 0, endLine: 0, exits: false });
    }
  }

  private ternary(node: t.ConditionalExpression, st: WalkState): void {
    this.walk(node.test, st);
    if (!this.matters([node.consequent, node.alternate])) {
      this.walk(node.consequent, st);
      this.walk(node.alternate, st);
      return;
    }
    const open = this.openBranch(st, 'ternary', this.short(node.test, 60), node);
    this.arm(open, st, 'yes', node.consequent);
    this.arm(open, st, 'no', node.alternate);
  }

  private tryStatement(node: t.TryStatement, st: WalkState): void {
    if (!node.handler || !this.matters([node.block])) {
      this.children(node, st);
      return;
    }
    const open = this.openBranch(st, 'try', 'if something fails', node);
    this.arm(open, st, 'it works', node.block);
    this.arm(open, st, 'it fails', node.handler.body);
    this.walk(node.finalizer, st);
  }

  private loop(node: t.Loop, st: WalkState): void {
    const inner: WalkState = { ...st, context: [...st.context, this.loopLabel(node)] };
    if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
      this.walk(node.right, st);
      this.walk(node.body, inner);
    } else if (node.type === 'ForStatement') {
      this.walk(node.init, st);
      this.walk(node.test, inner);
      this.walk(node.update, inner);
      this.walk(node.body, inner);
    } else {
      this.walk(node.test, inner);
      this.walk(node.body, inner);
    }
  }

  /** `onClick={save}` means a click calls save. */
  private jsxAttribute(node: t.JSXAttribute, st: WalkState): void {
    const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
    const value = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : null;
    if (!/^on[A-Z]/.test(name) || !value || value.type === 'JSXEmptyExpression') {
      this.children(node, st);
      return;
    }
    if (isInlineFunction(value)) {
      this.inline(value, st, name);
      return;
    }
    const callee = calleeRef(value);
    if (!callee) {
      this.walk(value, st);
      return;
    }
    st.fn.events.push({
      type: 'call',
      at: endOf(node),
      line: lineOf(node),
      text: `${this.short(value, 40)}()`,
      callee,
      path: [...st.path],
      context: [...st.context, name],
    });
  }

  // ---------- branches ----------

  private openBranch(st: WalkState, kind: BranchKind, subject: string, node: t.Node): OpenBranch {
    const branch: FlowBranch = {
      kind,
      subject,
      line: lineOf(node),
      at: startOf(node),
      end: endOf(node),
      arms: [],
      path: [...st.path],
    };
    st.fn.branches.push(branch);
    return { index: st.fn.branches.length - 1, branch };
  }

  /** Add one arm to a branch, then walk its code inside that arm. */
  private arm(
    open: OpenBranch,
    st: WalkState,
    label: string,
    body: t.Node | t.Node[] | null,
    extra: Partial<FlowArm> = {}
  ): void {
    const nodes = body === null ? [] : Array.isArray(body) ? body : [body];
    const last = nodes[nodes.length - 1];
    const armIndex = open.branch.arms.length;
    open.branch.arms.push({
      label,
      line: nodes.length ? lineOf(nodes[0]) : 0,
      endLine: last ? endLineOf(last) : 0,
      exits: endsFunction(last),
      ...extra,
    });
    const inner: WalkState = { ...st, path: [...st.path, [open.index, armIndex]] };
    for (const node of nodes) this.walk(node, inner);
  }

  /** Is there anything here a flow can show: a call, a throw or a return? */
  private matters(nodes: Array<t.Node | null | undefined>): boolean {
    const stack = nodes.filter(isNode);
    while (stack.length) {
      const node = stack.pop() as t.Node;
      if (
        node.type === 'CallExpression' ||
        node.type === 'OptionalCallExpression' ||
        node.type === 'ThrowStatement' ||
        node.type === 'ReturnStatement'
      ) {
        return true;
      }
      for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const value = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const item of value) if (isNode(item)) stack.push(item);
        } else if (isNode(value)) {
          stack.push(value);
        }
      }
    }
    return false;
  }

  // ---------- text ----------

  private newFunction(
    node: t.Node | null,
    name: string,
    owner: string | null,
    kind: FunctionKind,
    exported: boolean,
    parent: FlowFunction | null,
    register = true
  ): FlowFunction {
    const line = node ? lineOf(node) : 1;
    const base = `${this.file}#${owner ? `${owner}.` : ''}${name}`;
    const id = this.usedIds.has(base) ? `${base}@${line}` : base;
    this.usedIds.add(id);

    const fn: FlowFunction = {
      id,
      name,
      owner,
      kind,
      route: null,
      file: this.file,
      line,
      endLine: node ? endLineOf(node) : 1,
      params: [],
      exported,
      events: [],
      branches: [],
      localTypes: {},
      localResults: {},
      localFns: {},
      parent: parent?.id ?? null,
    };

    const params = node && 'params' in node && Array.isArray(node.params) ? (node.params as t.Node[]) : [];
    for (const param of params) {
      const info = this.param(param);
      fn.params.push(info.name);
      if (info.type) fn.localTypes[info.name] = info.type;
    }

    if (register) this.facts.functions.push(fn);
    return fn;
  }

  private param(node: t.Node): { name: string; type: string | null } {
    if (node.type === 'Identifier') return { name: node.name, type: typeName(node.typeAnnotation) };
    if (node.type === 'AssignmentPattern') return this.param(node.left);
    if (node.type === 'RestElement') return { name: `...${this.param(node.argument).name}`, type: null };
    if (node.type === 'TSParameterProperty') return this.param(node.parameter);
    if (node.type === 'ObjectPattern') {
      const keys = node.properties.map((p) =>
        p.type === 'RestElement' ? `...${this.param(p.argument).name}` : keyName(p.key) ?? '?'
      );
      return { name: `{ ${keys.join(', ')} }`, type: null };
    }
    if (node.type === 'ArrayPattern') {
      return { name: `[${node.elements.map((e) => (e ? this.param(e).name : '')).join(', ')}]`, type: null };
    }
    return { name: this.short(node, 24), type: null };
  }

  private caseValue(test: t.Node): string {
    const text = stringValue(test);
    if (text !== null) return text;
    if (test.type === 'NumericLiteral') return String(test.value);
    return this.short(test, 32);
  }

  private loopLabel(node: t.Loop): string {
    if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
      const left = node.left.type === 'VariableDeclaration' ? node.left.declarations[0]?.id : node.left;
      return `for each ${left ? this.short(left, 20) : 'item'}`;
    }
    if (node.type === 'WhileStatement' || node.type === 'DoWhileStatement') {
      return `while ${this.short(node.test, 28)}`;
    }
    return 'in a loop';
  }

  private thrownText(arg: t.Node): string {
    const value = unwrap(arg);
    if (value.type === 'NewExpression' && value.callee.type === 'Identifier') {
      const message = stringValue(value.arguments[0]);
      return message ? `${value.callee.name}("${message.length > 40 ? `${message.slice(0, 39)}…` : message}")` : value.callee.name;
    }
    return this.short(value, 48);
  }

  private calleeLine(callee: t.Node): number {
    const inner = unwrap(callee);
    if (inner.type === 'MemberExpression' || inner.type === 'OptionalMemberExpression') return lineOf(inner.property);
    return lineOf(inner);
  }

  /** The code of a node on one line, cut to `max` characters. */
  private short(node: t.Node, max = 60): string {
    const start = startOf(node);
    const raw = this.text.slice(start, Math.min(endOf(node), start + max * 4));
    const flat = raw.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  }

  /** A name for an anonymous default export: the file name, or the folder for index files. */
  private fileLabel(): string {
    const base = path.posix.basename(this.file).replace(/\.[^.]+$/, '');
    return base === 'index' ? path.posix.basename(path.posix.dirname(this.file)) || base : base;
  }
}
