import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FlowProject } from './resolve.js';
import type { ArmRef, FlowBranch, FlowEvent, FlowFunction } from './types.js';

/**
 * One function as a flow: the boxes it reaches, the calls between them, and
 * the condition on each call. This is what the dashboard draws and simulates.
 */

export type NodeKind = FlowFunction['kind'] | 'external' | 'error';

export interface FlowNode {
  id: string;
  kind: NodeKind;
  /** The big text: `changeStatus()`, `POST /orders`, `Pool.query()`. */
  name: string;
  /** The small text: the class and the file, or the package. */
  sub: string;
  file: string | null;
  line: number | null;
  depth: number;
  /** It calls more code than this flow shows. Start the flow there to see it. */
  more: boolean;
  /** Its lines changed in the story this flow was opened from. */
  changed: boolean;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Indexes into the caller's events. */
  events: number[];
  labels: string[];
  /** 1 for the first call the caller makes, 2 for the next, and so on. */
  order: number;
}

export interface EventView {
  type: FlowEvent['type'];
  at: number;
  line: number;
  text: string;
  path: ArmRef[];
  /** The condition and loop around it, in words: "case DONE" or "for each item of items". */
  label: string;
  /** The box it leads to, when that box is in this flow. */
  target: string | null;
}

export interface BranchView extends FlowBranch {
  /** Worth a choice in the simulation: an arm leads somewhere, or stops the function. */
  shown: boolean;
}

export interface FunctionView {
  id: string;
  name: string;
  owner: string | null;
  route: string | null;
  kind: FlowFunction['kind'];
  file: string;
  line: number;
  endLine: number;
  params: string[];
  code: string[];
  events: EventView[];
  branches: BranchView[];
  changedLines: number[];
  calledBy: Array<{ id: string; name: string }>;
}

export interface FlowGraph {
  entry: string;
  depth: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  functions: Record<string, FunctionView>;
  /** The box limit was reached, so some calls are not drawn. */
  truncated: boolean;
}

export interface GraphOptions {
  depth?: number;
  maxNodes?: number;
  /** Changed line numbers per file, for the "changed" marks. */
  changedLines?: Map<string, Set<number>>;
}

const MAX_CODE_LINES = 400;
const MAX_LABEL = 44;

export function displayName(fn: FlowFunction): string {
  if (fn.route) return fn.route;
  if (fn.name === '(top level)') return `${path.posix.basename(fn.file)}, top level`;
  return `${fn.name}()`;
}

function subText(project: FlowProject, fn: FlowFunction): string {
  const file = path.posix.basename(fn.file);
  if (fn.route && fn.name !== fn.route) return `${fn.owner ?? ''}.${fn.name}() · ${file}`;
  if (fn.parent) {
    const parent = project.functions.get(fn.parent);
    return `inside ${parent ? displayName(parent) : 'a function'} · ${file}`;
  }
  return fn.owner ? `${fn.owner} · ${file}` : file;
}

/** `!ticket` -> `ticket`, `a === b` -> `a !== b`, anything else -> `!(...)`. */
export function negate(test: string): string {
  const text = test.trim();
  if (/^![\w$.?]+$/.test(text)) return text.slice(1);
  if (/^[\w$.?]+$/.test(text)) return `!${text}`;
  const ops = text.match(/ (===|!==|==|!=|<=|>=|<|>) /g) ?? [];
  if (ops.length === 1 && !/&&|\|\||\?/.test(text)) {
    const swap: Record<string, string> = {
      '===': '!==', '!==': '===', '==': '!=', '!=': '==', '<=': '>', '>=': '<', '<': '>=', '>': '<=',
    };
    const op = ops[0].trim();
    return text.replace(` ${op} `, ` ${swap[op]} `);
  }
  return `!(${text})`;
}

/** The condition for one arm, as a reader would say it. */
export function armLabel(branch: FlowBranch, index: number): string {
  const arm = branch.arms[index];
  if (!arm) return '';
  switch (branch.kind) {
    case 'switch':
      return arm.label;
    case 'if':
    case 'ternary':
      return index === 0 ? `if ${branch.subject}` : `if ${negate(branch.subject)}`;
    case 'if-chain':
      return index === branch.arms.length - 1 ? 'else' : `if ${arm.label}`;
    case 'try':
      return index === 1 ? 'if it fails' : '';
  }
}

function eventLabel(fn: FlowFunction, event: FlowEvent): string {
  const last = event.path[event.path.length - 1];
  const condition = last ? armLabel(fn.branches[last[0]], last[1]) : '';
  const context = event.context[event.context.length - 1] ?? '';
  const label = [condition, context].filter(Boolean).join(' · ');
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

/** Lines of this function that changed. Top-level code only counts lines outside every function. */
export function changedLinesOf(project: FlowProject, fn: FlowFunction, changed: Map<string, Set<number>>): number[] {
  const lines = changed.get(fn.file);
  if (!lines?.size) return [];
  let inside = [...lines].filter((n) => n >= fn.line && n <= fn.endLine);
  if (fn.name === '(top level)') {
    const others = project.files.get(fn.file)?.functions.filter((f) => f.id !== fn.id) ?? [];
    inside = inside.filter((n) => !others.some((f) => n >= f.line && n <= f.endLine));
  }
  return inside.sort((a, b) => a - b);
}

export function buildFlowGraph(project: FlowProject, entryId: string, options: GraphOptions = {}): FlowGraph | null {
  const entry = project.functions.get(entryId);
  if (!entry) return null;

  const maxDepth = options.depth ?? 3;
  const maxNodes = options.maxNodes ?? 60;
  const changed = options.changedLines ?? new Map<string, Set<number>>();
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  let truncated = false;

  const addFunction = (fn: FlowFunction, depth: number): void => {
    nodes.set(fn.id, {
      id: fn.id,
      kind: fn.kind,
      name: displayName(fn),
      sub: subText(project, fn),
      file: fn.file,
      line: fn.line,
      depth,
      more: false,
      changed: changedLinesOf(project, fn, changed).length > 0,
    });
  };

  // Breadth first, so every box sits in the column of the shortest way to it.
  addFunction(entry, 0);
  const queue = [entry.id];
  while (queue.length) {
    const id = queue.shift() as string;
    const fn = project.functions.get(id) as FlowFunction;
    const node = nodes.get(id) as FlowNode;
    const targets = project.targets.get(id) ?? [];

    if (node.depth >= maxDepth) {
      node.more = fn.events.some((event, i) => event.type === 'throw' || targets[i]?.kind !== 'none');
      continue;
    }

    fn.events.forEach((event, index) => {
      const target = targets[index];
      let to: string | null = null;

      if (event.type === 'throw') {
        to = `error:${id}:${index}`;
        const name = event.text.replace(/\(.*$/, '');
        const message = event.text.slice(name.length).replace(/^\(|\)$/g, '');
        nodes.set(to, {
          id: to,
          kind: 'error',
          name,
          sub: message || `thrown in ${displayName(fn)}`,
          file: fn.file,
          line: event.line,
          depth: node.depth + 1,
          more: false,
          changed: false,
        });
      } else if (target?.kind === 'fn' && target.id !== id) {
        if (!nodes.has(target.id)) {
          if (nodes.size >= maxNodes) {
            truncated = true;
            return;
          }
          addFunction(project.functions.get(target.id) as FlowFunction, node.depth + 1);
          queue.push(target.id);
        }
        to = target.id;
      } else if (target?.kind === 'external') {
        to = `external:${target.module}:${target.name}`;
        if (!nodes.has(to)) {
          if (nodes.size >= maxNodes) {
            truncated = true;
            return;
          }
          nodes.set(to, {
            id: to,
            kind: 'external',
            name: `${target.name}()`,
            sub: target.module,
            file: null,
            line: null,
            depth: node.depth + 1,
            more: false,
            changed: false,
          });
        }
      }

      if (!to) return;
      const key = `${id}\n${to}`;
      const edge = edges.get(key) ?? { from: id, to, events: [], labels: [], order: 0 };
      edge.events.push(index);
      const label = eventLabel(fn, event);
      if (label && !edge.labels.includes(label)) edge.labels.push(label);
      edges.set(key, edge);
    });
  }

  // Number each caller's calls in the order they run.
  const byCaller = new Map<string, FlowEdge[]>();
  for (const edge of edges.values()) byCaller.set(edge.from, [...(byCaller.get(edge.from) ?? []), edge]);
  for (const list of byCaller.values()) {
    list.sort((a, b) => a.events[0] - b.events[0]);
    list.forEach((edge, i) => (edge.order = i + 1));
  }

  const files = new Map<string, string[]>();
  const linesOf = (file: string): string[] => {
    if (!files.has(file)) {
      try {
        files.set(file, readFileSync(path.join(project.root, file), 'utf8').split(/\r?\n/));
      } catch {
        files.set(file, []);
      }
    }
    return files.get(file) as string[];
  };

  const functions: Record<string, FunctionView> = {};
  for (const node of nodes.values()) {
    const fn = project.functions.get(node.id);
    if (fn) functions[fn.id] = functionView(project, fn, nodes, changed, linesOf);
  }

  return {
    entry: entry.id,
    depth: maxDepth,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    functions,
    truncated,
  };
}

function functionView(
  project: FlowProject,
  fn: FlowFunction,
  nodes: Map<string, FlowNode>,
  changed: Map<string, Set<number>>,
  linesOf: (file: string) => string[]
): FunctionView {
  const targets = project.targets.get(fn.id) ?? [];

  const events: EventView[] = fn.events.map((event, index) => {
    const target = targets[index];
    let to: string | null = null;
    if (event.type === 'throw') to = `error:${fn.id}:${index}`;
    else if (target?.kind === 'fn') to = target.id;
    else if (target?.kind === 'external') to = `external:${target.module}:${target.name}`;
    return {
      type: event.type,
      at: event.at,
      line: event.line,
      text: event.text,
      path: event.path,
      label: eventLabel(fn, event),
      target: to && to !== fn.id && nodes.has(to) ? to : null,
    };
  });

  const leadsSomewhere = (branch: number): boolean =>
    events.some((e) => (e.target || e.type === 'throw') && e.path.some(([b]) => b === branch));

  const end = Math.min(fn.endLine, fn.line + MAX_CODE_LINES - 1);
  return {
    id: fn.id,
    name: fn.name,
    owner: fn.owner,
    route: fn.route,
    kind: fn.kind,
    file: fn.file,
    line: fn.line,
    endLine: end,
    params: fn.params,
    code: linesOf(fn.file).slice(fn.line - 1, end),
    events,
    branches: fn.branches.map((branch, b) => ({
      ...branch,
      shown: branch.arms.some((arm) => arm.exits) || leadsSomewhere(b),
    })),
    changedLines: changedLinesOf(project, fn, changed),
    calledBy: (project.callers.get(fn.id) ?? []).slice(0, 12).map((id) => {
      const caller = project.functions.get(id);
      return { id, name: caller ? displayName(caller) : id };
    }),
  };
}
