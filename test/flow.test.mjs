// Flow tests. Run with `npm test` (it builds first).
// The fixture in test/fixtures/tickets is a tiny project in both styles:
// a TypeScript service with classes, and an Express app in CommonJS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFlowCache } from '../dist/core/flow/cache.js';
import { buildFlowGraph } from '../dist/core/flow/graph.js';
import { flowStarts, searchFunctions } from '../dist/core/flow/resolve.js';
import { readFlowFacts } from '../dist/core/flow/parse.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tickets');
const project = createFlowCache(fixture).get();

const SERVICE = 'src/tickets/ticket.service.ts#TicketService.changeStatus';
const ROUTE = 'src/tickets/tickets.controller.ts#TicketsController.changeStatus';

function targetsOf(id) {
  const fn = project.functions.get(id);
  return fn.events.map((event, i) => ({ text: event.text, target: project.targets.get(id)[i] }));
}

test('every fixture file parses', () => {
  assert.deepEqual(project.parseErrors, []);
});

test('a switch becomes one branch with an arm per case, plus "no match"', () => {
  const fn = project.functions.get(SERVICE);
  const branch = fn.branches.find((b) => b.kind === 'switch');
  assert.equal(branch.subject, 'status');
  assert.deepEqual(
    branch.arms.map((arm) => arm.label),
    ['case TODO', 'case IN_PROGRESS', 'case DONE', 'no match']
  );
});

test('this.repo.save() follows the TS type to the only class that implements it', () => {
  const save = targetsOf(SERVICE).find((c) => c.text === 'this.repo.save()');
  assert.deepEqual(save.target, { kind: 'fn', id: 'src/tickets/ticket.repository.ts#SqlTicketRepository.save' });
});

test('calls into packages are marked as outside the project', () => {
  const publish = targetsOf(SERVICE).find((c) => c.text.startsWith('this.events.publish'));
  assert.deepEqual(publish.target, { kind: 'external', module: '@nestjs/cqrs', name: 'EventBus.publish' });
  const query = targetsOf('src/tickets/ticket.repository.ts#SqlTicketRepository.findById')[0];
  assert.deepEqual(query.target, { kind: 'external', module: 'pg', name: 'Pool.query' });
});

test('CommonJS require and module.exports are followed', () => {
  const route = [...project.functions.values()].find((fn) => fn.route === 'POST /register');
  const targets = targetsOf(route.id).map((c) => c.target);
  assert.ok(targets.some((t) => t.kind === 'fn' && t.id === 'app/lib/hash.js#hashPassword'));
  assert.ok(targets.some((t) => t.kind === 'fn' && t.id === 'app/lib/users.js#find'));
});

test('a Nest route decorator names the route', () => {
  assert.equal(project.functions.get(ROUTE).route, 'PATCH /tickets/:id/status');
  assert.deepEqual(
    flowStarts(project).routes.map((r) => r.label).sort(),
    ['PATCH /tickets/:id/status', 'POST /login', 'POST /register']
  );
});

test('the graph labels each call with its condition, and a throw becomes an error box', () => {
  const graph = buildFlowGraph(project, ROUTE, { depth: 3 });
  const label = (fromName, toName) => {
    const from = graph.nodes.find((n) => n.name === fromName);
    const to = graph.nodes.find((n) => n.name === toName);
    return graph.edges.find((e) => e.from === from.id && e.to === to.id)?.labels;
  };
  assert.deepEqual(label('changeStatus()', 'notifyAssignee()'), ['case IN_PROGRESS']);
  assert.deepEqual(label('validateTicket()', 'TicketNotFoundError'), ['if !ticket']);
  assert.equal(graph.nodes.find((n) => n.name === 'TicketNotFoundError').kind, 'error');
});

test('an arm that returns or throws is marked as ending the function', () => {
  const fn = project.functions.get('src/tickets/ticket.service.ts#TicketService.validateTicket');
  const guard = fn.branches.find((b) => b.subject === '!ticket');
  assert.deepEqual(guard.arms.map((arm) => arm.exits), [true, false]);
});

test('a client call like api.post("/login", body) is not mistaken for a route', () => {
  const facts = readFlowFacts(
    'client/login.ts',
    `import { api } from './api';\nexport async function login(body) {\n  return api.post('/api/login', body);\n}\n`
  );
  assert.equal(facts.functions.filter((fn) => fn.kind === 'route').length, 0);
});

test('search finds a method by its class name too', () => {
  const hits = searchFunctions(project, 'TicketService.changeStatus');
  assert.equal(hits[0].id, SERVICE);
});
