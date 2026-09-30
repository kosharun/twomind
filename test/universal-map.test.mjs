import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodeMap, searchSymbols } from '../dist/core/codemap.js';
import { createFlowCache } from '../dist/core/flow/cache.js';
import { flowStarts } from '../dist/core/flow/resolve.js';
import { scanProject } from '../dist/core/scan.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'java-spring');
const project = createFlowCache(fixture).get();

const CONTROLLER = 'src/main/java/de/bitconex/negotiation/NegotiationController.java#NegotiationController.findById';
const SERVICE = 'src/main/java/de/bitconex/negotiation/NegotiationService.java#NegotiationService.findById';
const REPOSITORY = 'src/main/java/de/bitconex/negotiation/NegotiationRepository.java#NegotiationRepository.findById';

function targetFor(id, text) {
  const fn = project.functions.get(id);
  const index = fn.events.findIndex((event) => event.text === text);
  return project.targets.get(id)[index];
}

test('Java and Spring files get methods, routes, and calls in the flow map', () => {
  assert.deepEqual(project.parseErrors, []);
  assert.equal(project.functions.get(CONTROLLER).route, 'GET /negotiations/{id}');
  assert.deepEqual(targetFor(CONTROLLER, 'negotiationService.findById(id)'), { kind: 'fn', id: SERVICE });
  assert.deepEqual(targetFor(SERVICE, 'validate(id)'), {
    kind: 'fn',
    id: 'src/main/java/de/bitconex/negotiation/NegotiationService.java#NegotiationService.validate',
  });
  assert.deepEqual(targetFor(SERVICE, 'repository.findById(id)'), { kind: 'fn', id: REPOSITORY });
  assert.ok(flowStarts(project).routes.some((route) => route.label === 'GET /negotiations/{id}'));
});

test('the normal code map lists Java classes, methods, and files', () => {
  const map = buildCodeMap(fixture);
  assert.ok(searchSymbols(map, 'NegotiationController').some((hit) => hit.kind === 'class'));
  assert.ok(searchSymbols(map, 'NegotiationService.java').some((hit) => hit.kind === 'file'));
  assert.ok(searchSymbols(map, 'validate').some((hit) => hit.kind === 'function'));
});

test('the setup scan recognises Maven, Spring, Java, and its test command', () => {
  const scan = scanProject(fixture);
  assert.ok(scan.languages.includes('Java'));
  assert.ok(scan.frameworks.includes('Spring'));
  assert.equal(scan.packageManager, 'Maven');
  assert.equal(scan.testCommand, 'mvn test');
});

test('an unfamiliar readable source extension still appears in file search', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'twomind-any-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'engine.xyzlang'), 'module Engine {\n  boot() { return 1; }\n}\n', 'utf8');

  const map = buildCodeMap(root);
  assert.equal(map.files.length, 1);
  assert.deepEqual(searchSymbols(map, 'engine.xyzlang')[0], {
    name: 'engine.xyzlang',
    file: 'engine.xyzlang',
    kind: 'file',
    usedByCount: 0,
  });
});
