'use strict';

const { handleReflectionFlow } = require('../flows/reflectionFlow');

/**
 * Minimal in-memory SessionStore stand-in — mirrors the get/set/delete
 * shape reflectionFlow.js expects, with per-phoneHash isolation.
 */
function createSessionStore() {
  const store = new Map();
  return {
    get: (phoneHash) => store.get(phoneHash) || null,
    set: (phoneHash, value) => store.set(phoneHash, value),
    delete: (phoneHash) => store.delete(phoneHash),
    __raw: store,
  };
}

function createDeps(overrides = {}) {
  const reflectionState = createSessionStore();
  const safeSendMessage = jest.fn().mockResolvedValue(undefined);
  const parseIntent = jest.fn().mockReturnValue({ type: 'reflection' });
  const hashPhone = jest.fn((from) => `hash:${from}`);
  const createReflection = jest.fn().mockReturnValue({ id: 1 });
  const getCurrentTerm = jest.fn().mockReturnValue(2);

  return {
    reflectionState,
    safeSendMessage,
    parseIntent,
    hashPhone,
    createReflection,
    getCurrentTerm,
    ...overrides,
  };
}

async function runHappyPathUpTo(deps, from, step) {
  // 'REFLECT' triggers entry (parseIntent mocked to return reflection)
  await handleReflectionFlow(from, 'REFLECT', null, deps);
  if (step === 'entry') return;

  await handleReflectionFlow(from, 'Fractions Grade 6', null, deps); // lesson
  if (step === 'awaitingWentWell') return;

  await handleReflectionFlow(from, 'Learners understood equivalent fractions.', null, deps); // went well
  if (step === 'awaitingImprovement') return;

  await handleReflectionFlow(from, 'More practical examples.', null, deps); // improvement -> reviewSummary
}

describe('reflectionFlow', () => {
  describe('happy path', () => {
    it('collects all three fields and saves on YES', async () => {
      const deps = createDeps();
      const from = '+27000000001';

      await runHappyPathUpTo(deps, from, 'reviewSummary');
      await handleReflectionFlow(from, 'YES', null, deps);

      expect(deps.createReflection).toHaveBeenCalledTimes(1);
      const [phoneHash, payload] = deps.createReflection.mock.calls[0];

      expect(phoneHash).toBe('hash:+27000000001');
      expect(payload.term).toBe(2);
      expect(payload.aiAssisted).toBe(false);
      expect(payload.evidenceLinkIds).toEqual([]);
      expect(payload.content).toContain('Lesson:\nFractions Grade 6');
      expect(payload.content).toContain('What went well:\nLearners understood equivalent fractions.');
      expect(payload.content).toContain('What I would improve:\nMore practical examples.');

      // state cleared after save
      expect(deps.reflectionState.get('hash:+27000000001')).toBeNull();
    });
  });

  describe('correction path', () => {
    it('replaces only the chosen field and saves once with the corrected content', async () => {
      const deps = createDeps();
      const from = '+27000000002';

      await runHappyPathUpTo(deps, from, 'reviewSummary');
      await handleReflectionFlow(from, 'NO', null, deps); // -> awaitingCorrectionChoice
      await handleReflectionFlow(from, '1', null, deps); // choose Lesson -> awaitingLesson (correcting)
      await handleReflectionFlow(from, 'Fractions Grade 7 (corrected)', null, deps); // -> back to reviewSummary
      await handleReflectionFlow(from, 'YES', null, deps);

      expect(deps.createReflection).toHaveBeenCalledTimes(1);
      const [, payload] = deps.createReflection.mock.calls[0];

      expect(payload.content).toContain('Lesson:\nFractions Grade 7 (corrected)');
      expect(payload.content).toContain('What went well:\nLearners understood equivalent fractions.');
      expect(payload.content).toContain('What I would improve:\nMore practical examples.');
      expect(payload.content).not.toContain('Fractions Grade 6\n');
    });
  });

  describe('cancel', () => {
    const cancelSteps = [
      { name: 'awaitingLesson', drive: async (deps, from) => {
        await handleReflectionFlow(from, 'REFLECT', null, deps);
      } },
      { name: 'awaitingWentWell', drive: async (deps, from) => {
        await handleReflectionFlow(from, 'REFLECT', null, deps);
        await handleReflectionFlow(from, 'Lesson text', null, deps);
      } },
      { name: 'awaitingImprovement', drive: async (deps, from) => {
        await handleReflectionFlow(from, 'REFLECT', null, deps);
        await handleReflectionFlow(from, 'Lesson text', null, deps);
        await handleReflectionFlow(from, 'Went well text', null, deps);
      } },
      { name: 'reviewSummary', drive: async (deps, from) => {
        await runHappyPathUpTo(deps, from, 'reviewSummary');
      } },
      { name: 'awaitingCorrectionChoice', drive: async (deps, from) => {
        await runHappyPathUpTo(deps, from, 'reviewSummary');
        await handleReflectionFlow(from, 'NO', null, deps);
      } },
    ];

    it.each(cancelSteps)('cancels cleanly from $name without ever saving', async ({ drive }) => {
      const deps = createDeps();
      const from = '+27000000003';

      await drive(deps, from);
      await handleReflectionFlow(from, 'CANCEL', null, deps);

      expect(deps.createReflection).not.toHaveBeenCalled();
      expect(deps.reflectionState.get('hash:+27000000003')).toBeNull();
    });
  });

  describe('timeout', () => {
    it('drops stale state and does not treat the message as handled', async () => {
      const deps = createDeps();
      const from = '+27000000004';
      const phoneHash = 'hash:+27000000004';

      deps.reflectionState.set(phoneHash, {
        step: 'awaitingLesson',
        lastActivity: Date.now() - 31 * 60 * 1000,
      });

      const handled = await handleReflectionFlow(from, 'some text', null, deps);

      expect(handled).toBe(false);
      expect(deps.reflectionState.get(phoneHash)).toBeNull();
    });
  });

  describe('session isolation', () => {
    it('keeps two teachers\' in-progress reflections independent', async () => {
      const deps = createDeps();
      const teacherA = '+27000000005';
      const teacherB = '+27000000006';

      await handleReflectionFlow(teacherA, 'REFLECT', null, deps);
      await handleReflectionFlow(teacherA, 'Teacher A lesson', null, deps);

      await handleReflectionFlow(teacherB, 'REFLECT', null, deps);
      await handleReflectionFlow(teacherB, 'Teacher B lesson', null, deps);

      const stateA = deps.reflectionState.get('hash:+27000000005');
      const stateB = deps.reflectionState.get('hash:+27000000006');

      expect(stateA.lesson).toBe('Teacher A lesson');
      expect(stateB.lesson).toBe('Teacher B lesson');
      expect(stateA.lesson).not.toBe(stateB.lesson);
    });
  });

  describe('term unavailable', () => {
    it('does not save and tells the teacher when getCurrentTerm returns null', async () => {
      const deps = createDeps({ getCurrentTerm: jest.fn().mockReturnValue(null) });
      const from = '+27000000007';

      await runHappyPathUpTo(deps, from, 'reviewSummary');
      await handleReflectionFlow(from, 'YES', null, deps);

      expect(deps.createReflection).not.toHaveBeenCalled();
      expect(deps.reflectionState.get('hash:+27000000007')).toBeNull();

      const lastMessage = deps.safeSendMessage.mock.calls[deps.safeSendMessage.mock.calls.length - 1][1];
      expect(lastMessage).toMatch(/couldn't determine the current school term/i);
    });
  });

  describe('invalid confirmation reply', () => {
    it('stays on reviewSummary and preserves the collected fields', async () => {
      const deps = createDeps();
      const from = '+27000000008';

      await runHappyPathUpTo(deps, from, 'reviewSummary');
      await handleReflectionFlow(from, 'maybe', null, deps);

      expect(deps.createReflection).not.toHaveBeenCalled();

      const state = deps.reflectionState.get('hash:+27000000008');
      expect(state.step).toBe('reviewSummary');
      expect(state.lesson).toBe('Fractions Grade 6');
      expect(state.wentWell).toBe('Learners understood equivalent fractions.');
      expect(state.improvement).toBe('More practical examples.');
    });
  });
});
