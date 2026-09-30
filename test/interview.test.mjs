import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestions } from '../dist/commands/init.js';
import {
  emptyAnswers,
  renderOverview,
  renderRules,
  renderUserProfile,
  renderWorkflow,
} from '../dist/core/brain.js';

const scan = {
  name: 'booknest',
  description: 'People save books and private reading notes.',
  languages: ['TypeScript'],
  frameworks: ['Next.js'],
  packageManager: 'npm',
  testCommand: 'npm test',
  databases: ['PostgreSQL'],
  topFolders: ['src', 'test'],
  contextFiles: [],
  contextTokens: 0,
  hasGit: true,
};

test('init asks the new 12 owner questions in order', () => {
  const questions = buildQuestions(scan);

  assert.equal(questions.length, 12);
  assert.deepEqual(
    questions.map((question) => question.key),
    [
      'audienceAndPurpose',
      'currentAndNext',
      'riskyAreas',
      'alwaysAsk',
      'safeWithoutAsking',
      'protectedAreas',
      'sourceOfTruth',
      'patternToFollow',
      'doneChecks',
      'whenUnclearOrFailing',
      'storyPreference',
      'pastMistake',
    ]
  );
  assert.match(questions[0].ask, /Who is this project for/);
  assert.match(questions[11].ask, /mistake an AI made/);
});

test('every interview answer is written somewhere useful', () => {
  const answers = emptyAnswers();
  Object.keys(answers).forEach((key, index) => {
    answers[key] = `answer-${index + 1}-${key}`;
  });

  const written = [
    renderOverview(scan, answers),
    renderRules(answers),
    renderWorkflow(scan, answers),
    renderUserProfile(answers),
  ].join('\n');

  for (const answer of Object.values(answers)) {
    assert.match(written, new RegExp(answer));
  }
  assert.match(written, /npm test/);
  assert.match(written, /Next\.js/);
});
