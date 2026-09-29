/**
 * Shapes shared by the flow parser, the resolver and the graph builder.
 *
 * Everything in the flow folder is a fact read from the code: what a function
 * calls, in what order, and under which condition. Nothing here says what is
 * "important" or "business logic". That kind of meaning comes from the agent's
 * stories, never from this folder.
 */

export type FunctionKind = 'function' | 'method' | 'route';

/** Which arm of which branch something sits in: [branch index, arm index]. */
export type ArmRef = [number, number];

/** How a call names what it calls, before we know where that lives. */
export type CalleeRef =
  | { kind: 'name'; name: string } // save()
  | { kind: 'this'; name: string } // this.validate()
  | { kind: 'thisField'; field: string; name: string } // this.repo.save()
  | { kind: 'member'; object: string; name: string } // repo.save(), bcrypt.hash()
  | { kind: 'super'; name: string }; // super.save()

export interface FlowEvent {
  type: 'call' | 'throw';
  /** Offset where the call ends in the file. Sorting by it gives the run order. */
  at: number;
  line: number;
  /** The code, shortened: `this.repo.save()` or `new NotFoundError("...")`. */
  text: string;
  callee?: CalleeRef;
  /** The branch arms this event sits in, outermost first. */
  path: ArmRef[];
  /** Loops and callbacks around the event, like "for each item of items". */
  context: string[];
}

export interface FlowArm {
  label: string;
  /** For a switch case, the case value: TODO, not 'TODO'. */
  value?: string;
  /** 0 when the arm has no code of its own, like an `if` with no `else`. */
  line: number;
  endLine: number;
  /** The arm ends with return or throw, so the function stops there. */
  exits: boolean;
}

export type BranchKind = 'if' | 'if-chain' | 'switch' | 'ternary' | 'try';

export interface FlowBranch {
  kind: BranchKind;
  /** The switch subject or the if test, as written in the code. */
  subject: string;
  line: number;
  at: number;
  end: number;
  arms: FlowArm[];
  /** The arms this branch itself sits in. */
  path: ArmRef[];
}

export interface FlowFunction {
  /** `file#Owner.name`, with `@line` added when a file has two of the same name. */
  id: string;
  name: string;
  /** The class or object it belongs to. */
  owner: string | null;
  kind: FunctionKind;
  /** "POST /orders" for route handlers. */
  route: string | null;
  file: string;
  line: number;
  endLine: number;
  params: string[];
  exported: boolean;
  events: FlowEvent[];
  branches: FlowBranch[];
  /** Local names with a known class: typed params, `const x = new X()`. */
  localTypes: Record<string, string>;
  /** Local names that hold what a call returned: `const client = await pool.connect()`. */
  localResults: Record<string, CalleeRef>;
  /** Named functions declared inside this one: name -> id. */
  localFns: Record<string, string>;
  /** The function this one is declared inside, if any. */
  parent: string | null;
}
