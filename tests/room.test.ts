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

describe('mate room (deferred grading)', () => {
  it('mate host can choose deferred grading; drafts grade on submit', async () => {
    const f = await fixture();
    const { response, data } = await f.create({ ...settings, gradingMode: 'deferred' }, 'mate', 'ホスト');
    expect(response.status).toBe(201);
    const questions = await questionsOf(f, data.code);
    const host = await f.connect(data.code);
    const hostHello = await host.request({ type: 'hello', role: 'mate-host', token: data.token, participantId: data.participantId, nickname: 'ホスト' });
    expect(hostHello.state.room.settings.gradingMode).toBe('deferred');
    const guest = await f.connect(data.code);
    await guest.request(credentials('ゲスト'));
    await host.request({ type: 'start' });
    await new Promise(r => setTimeout(r, 5600));
    let gseq = 0;
    for (const q of questions) {
      const res = await guest.request({ type: 'draft', seq: ++gseq, answers: [{ questionId: q.id, fieldId: 'choice', value: q.answer.targetId }], advancedQuestionCount: q.ordinal });
      expect(res.type).toBe('ack');
    }
    const guestSubmitted = await guest.request({ type: 'submit', seq: ++gseq });
    expect(guestSubmitted.state.room.state).toBe('RUNNING');
    expect(guestSubmitted.state.own.finished).toBe(true);
    let hseq = 0;
    for (const q of questions) {
      await host.request({ type: 'draft', seq: ++hseq, answers: [{ questionId: q.id, fieldId: 'choice', value: q.answer.targetId }], advancedQuestionCount: q.ordinal });
    }
    const hostSubmitted = await host.request({ type: 'submit', seq: ++hseq });
    expect(hostSubmitted.state.room.state).toBe('FINISHED');
    expect(hostSubmitted.state.results.own.correctCount).toBe(5);
    const guestState = await guest.request({ type: 'sync' });
    expect(guestState.state.results.own.correctCount).toBe(5);
    await f.runtime.dispose();
  }, 30000);
});

it('finishes a deferred mate room when the host submits first, and hides scores until the end', async () => {
  const f = await fixture(false);
  const { response, data } = await f.create({ ...settings, questionCount: 5, gradingMode: 'deferred' }, 'mate', 'ホスト');
  expect(response.status).toBe(201);
  const questions = await questionsOf(f, data.code);
  const host = await f.connect(data.code);
  await host.request({ type: 'hello', role: 'mate-host', token: data.token, participantId: data.participantId, nickname: 'ホスト' });
  const guest = await f.connect(data.code);
  const guestHello = await guest.request(credentials('ゲスト'));
  const guestId = guestHello.state.own.id as string;
  await host.request({ type: 'start' });
  await new Promise(r => setTimeout(r, 5600));
  let gseq = 0;
  for (const q of questions) await guest.request({ type: 'draft', seq: ++gseq, answers: [{ questionId: q.id, fieldId: 'choice', value: q.answer.targetId }], advancedQuestionCount: q.ordinal });
  let hseq = 0;
  for (const q of questions) await host.request({ type: 'draft', seq: ++hseq, answers: [{ questionId: q.id, fieldId: 'choice', value: q.answer.targetId }], advancedQuestionCount: q.ordinal });
  const afterHost = await host.request({ type: 'submit', seq: ++hseq });
  expect(afterHost.state.room.state).toBe('RUNNING');
  expect(afterHost.state.participants.find((p: any) => p.id === guestId).finished).toBe(false);
  // P1: graded scores stay hidden in snapshots until FINISHED, also in mate rooms.
  expect(afterHost.state.participants.every((p: any) => p.correctCount === 0)).toBe(true);
  const done = await guest.request({ type: 'submit', seq: ++gseq });
  expect(done.state.room.state).toBe('FINISHED');
  expect(done.state.results.own.correctCount).toBe(5);
  expect(done.state.participants.find((p: any) => p.id === data.participantId).correctCount).toBe(5);
  await f.runtime.dispose();
}, 30000);

it('applies lobby settings changes before start and rejects them after start', async () => {
  const f = await fixture(false);
  const { response, data } = await f.create({ ...settings, questionCount: 5, gradingMode: 'immediate' }, 'mate', 'ホスト');
  expect(response.status).toBe(201);
  const host = await f.connect(data.code);
  const hello = await host.request({ type: 'hello', role: 'mate-host', token: data.token, participantId: data.participantId, nickname: 'ホスト' });
  const changed = await host.request({ type: 'settings', settings: { ...hello.state.room.settings, gradingMode: 'deferred' } });
  expect(changed.state.room.settings.gradingMode).toBe('deferred');
  const guest = await f.connect(data.code);
  await guest.request(credentials('ゲスト'));
  const started = await host.request({ type: 'start' });
  expect(started.state.room.settings.gradingMode).toBe('deferred');
  const rejected = await host.request({ type: 'settings', settings: { ...started.state.room.settings, gradingMode: 'immediate' } });
  expect(rejected.type).toBe('error');
  expect(rejected.code).toBe('not_waiting');
  await f.runtime.dispose();
}, 30000);

it('admits and reconnects 50 classroom participants behind one network', async () => {
  const f = await fixture();
  try {
    const { data } = await f.create();
    const unknown = await f.connect(data.code);
    const rejected = await unknown.request({ ...credentials('未登録'), resumeOnly: true });
    expect(rejected.code).toBe('unauthorized');
    const ip = '192.0.2.1';
    const students = Array.from({ length: 50 }, (_, i) => credentials(`生徒${i + 1}`));
    const clients = await Promise.all(students.map(async student => {
      const info = await f.fetch(`/api/rooms/${data.code}/info`, { headers: { 'cf-connecting-ip': ip } });
      expect(info.status).toBe(200);
      const client = await f.connect(data.code, ip);
      expect((await client.request(student)).type).toBe('ack');
      return client;
    }));
    clients.forEach(client => client.socket.close());
    await Promise.all(students.map(async student => {
      const reconnected = await f.connect(data.code, ip);
      const result = await reconnected.request({ ...student, resumeOnly: true });
      expect(result.state.room.participantCount).toBe(50);
      expect(result.state.own.id).toBe(student.participantId);
    }));
  } finally {
    await f.runtime.dispose();
  }
}, 30000);

it('collects a cleared draft at the cutoff and grades unanswered fields accurately', async () => {
  const f = await fixture();
  try {
    const { data } = await f.create({ ...settings, gradingMode: 'deferred' });
    const teacher = await f.connect(data.code);
    await teacher.request(teacherHello(data.token));
    const student = await f.connect(data.code);
    await student.request(credentials('締切テスト'));
    await teacher.request({ type: 'start' });

    const store = await f.storage(data.code);
    const start = Date.now() - 1000;
    await store.exec('UPDATE room SET start_at=?', start);
    const [question] = await questionsOf(f, data.code);
    const draft = { questionId: question.id, fieldId: 'choice', value: question.answer.targetId };
    expect((await student.request({ type: 'draft', seq: 1, answers: [draft] })).type).toBe('ack');

    const stopped = await teacher.request({ type: 'finish' });
    expect(stopped.state.room.state).toBe('COLLECTING');
    const cutoff = stopped.state.room.cutoffAtMs;
    const clear = { ...draft, value: '' };
    const late = await student.request({ type: 'draft', seq: 2, capturedAtMs: cutoff + 1, answers: [clear] });
    expect(late.code).toBe('not_running');
    expect((await student.request({ type: 'draft', seq: 2, capturedAtMs: cutoff, answers: [clear] })).type).toBe('ack');
    const result = await student.request({ type: 'submit', seq: 3, final: true });
    expect(result.state.room.state).toBe('FINISHED');
    expect(result.state.results.own.correctCount).toBe(0);
    expect(result.state.results.own.finalSyncUnconfirmed).toBe(false);
    expect(result.state.results.questions[0].fields[0].state).toBe('unanswered');
  } finally {
    await f.runtime.dispose();
  }
}, 30000);
