import { describe, expect, it } from 'vitest';
import { fixture, settings, credentials, teacherHello } from './helpers';
import type { InternalQuestion } from '../game/types';

async function questionsOf(f: Awaited<ReturnType<typeof fixture>>, code: string): Promise<InternalQuestion[]> {
  const store = await f.storage(code);
  const { rows } = await store.exec('SELECT questions FROM room');
  return JSON.parse((rows as any)[0].questions);
}

describe('room flow (immediate, four-choice)', () => {
  it('creates with questions fixed, runs, and scores a correct answer', async () => {
    const f = await fixture();
    const { response, data } = await f.create();
    expect(response.status).toBe(201);
    const questions = await questionsOf(f, data.code);
    expect(questions.length).toBe(5); // fixed at creation time, per spec

    const teacher = await f.connect(data.code);
    const tHello = await teacher.request(teacherHello(data.token));
    expect(tHello.state.room.state).toBe('WAITING');

    const student = await f.connect(data.code);
    const cred = credentials('たろう');
    const sHello = await student.request(cred);
    expect(sHello.state.room.participantCount).toBe(1);

    const started = await teacher.request({ type: 'start' });
    expect(started.state.room.state).toBe('COUNTDOWN'); // 5s countdown before start_at

    // Wait until start_at passes on the server clock.
    await new Promise(r => setTimeout(r, 5600));
    const sync = await student.request({ type: 'sync' });
    const current = sync.state.question;
    expect(current).toBeTruthy();
    const stored = questions.find(q => q.id === current.id)!;
    const answer = await student.request({ type: 'answer', seq: 1, questionId: current.id, fieldId: 'choice', value: stored.answer.targetId });
    expect(answer.verdict.correct).toBe(true);
    expect(answer.state.own.correctCount).toBe(1);
    await f.runtime.dispose();
  }, 30000);

  it('rejects room creation when the range cannot build the set', async () => {
    const f = await fixture();
    const { response, data } = await f.create({ ...settings, units: ['脂肪族炭化水素'], directions: ['C'] });
    expect(response.status).toBe(400);
    expect(data.error).toContain('性質問題');
    await f.runtime.dispose();
  });
});

describe('room flow (deferred)', () => {
  it('grades drafts on submit and finishes the room', async () => {
    const f = await fixture();
    const { data } = await f.create({ ...settings, gradingMode: 'deferred' });
    const questions = await questionsOf(f, data.code);
    const teacher = await f.connect(data.code);
    await teacher.request(teacherHello(data.token));
    const student = await f.connect(data.code);
    await student.request(credentials('はなこ'));
    await teacher.request({ type: 'start' });
    await new Promise(r => setTimeout(r, 5600));
    let seq = 0;
    for (const q of questions) {
      const res = await student.request({ type: 'draft', seq: ++seq, answers: [{ questionId: q.id, fieldId: 'choice', value: q.answer.targetId }], advancedQuestionCount: q.ordinal });
      expect(res.type).toBe('ack');
    }
    const submitted = await student.request({ type: 'submit', seq: ++seq });
    expect(submitted.state.room.state).toBe('FINISHED');
    expect(submitted.state.results.own.correctCount).toBe(5);
    await f.runtime.dispose();
  }, 30000);
});

describe('exclusion profile', () => {
  it('master saves with revision check; rooms snapshot it at creation', async () => {
    const f = await fixture();
    const put = await f.fetch('/api/teacher/exclusion-profile', { method: 'PUT', headers: { ...f.teacherHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ revision: 1, profile: { version: 1, excludedIds: ['ethanol'] } }) });
    expect(put.status).toBe(200);
    const got = await (await f.fetch('/api/exclusion-profile')).json() as any;
    expect(got.revision).toBe(2);
    expect(got.profile.excludedIds).toEqual(['ethanol']);
    const stale = await f.fetch('/api/teacher/exclusion-profile', { method: 'PUT', headers: { ...f.teacherHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ revision: 1, profile: { version: 1, excludedIds: [] } }) });
    expect(stale.status).toBe(409);
    const { data } = await f.create();
    const questions = await questionsOf(f, data.code);
    for (const q of questions) if (q.prompt.kind === 'four') expect(q.prompt.choices.map(c => c.id)).not.toContain('ethanol');
    await f.runtime.dispose();
  });
});
