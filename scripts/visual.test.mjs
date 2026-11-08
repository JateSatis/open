import assert from 'node:assert/strict';
import test from 'node:test';
import { captureOptions, restoreSettings, validateFlowResult, actionTimeline } from './visual.mjs';
import { parseFrameSummary, frameSql } from './visual-tools.mjs';

test('захват ограничен по времени и не допускает случайных режимов/путей', () => {
  for (const value of ['0', '-1', '121', 'Infinity', '3.5'])
    assert.throws(() => captureOptions(['--seconds', value]));
  assert.throws(() => captureOptions(['--mode', 'both']));
  assert.throws(() => captureOptions(['--mode', 'trace', '--gestures']));
  assert.throws(() => captureOptions(['--flow', '../evil']));
  assert.equal(captureOptions([]).mode, 'video');
});

test('отсутствие кадров и потеря данных не выдаются за гладкую анимацию', () => {
  assert.equal(parseFrameSummary('a,b,c,d,e\n0,0,0,0,0').status, 'no-frame-data');
  assert.equal(parseFrameSummary('a,b,c,d,e\n100,5,0,25,3').status, 'incomplete');
  assert.equal(parseFrameSummary('a,b,c,d,e\n100,5,0,25,0').jankPercent, 5);
  assert.throws(() => parseFrameSummary('SQL error'));
  assert.throws(() => frameSql("x'; delete"));
});

test('наличия MP4/нулевого exit code недостаточно для успешного сценария', () => {
  const ok = { code: 0, timedOut: false };
  validateFlowResult(ok, '<testcase name="tabs"/>', 10000, 30);
  for (const xml of [
    '',
    '<testsuite/>',
    '<testcase><failure/></testcase>',
    '<testcase><skipped/></testcase>',
  ])
    assert.throws(() => validateFlowResult(ok, xml, 10000, 30));
  assert.throws(() => validateFlowResult({ code: 1 }, '<testcase/>', 10000, 30));
  assert.throws(() => validateFlowResult(ok, '<testcase/>', 31000, 30));
});

test('настройки восстанавливаются включая удаление отсутствовавшего ключа', () => {
  const calls = [];
  restoreSettings('phone', { show_touches: '0', pointer_location: 'null' }, (...args) =>
    calls.push(args),
  );
  assert.deepEqual(calls, [
    ['phone', ['shell', 'settings', 'put', 'system', 'show_touches', '0']],
    ['phone', ['shell', 'settings', 'delete', 'system', 'pointer_location']],
  ]);
});

test('короткая лента действий не копирует окружение и вводимый текст', () => {
  const timeline = actionTimeline(
    [
      { command: { defineVariablesCommand: { env: { token: 'secret' } } } },
      {
        command: { inputTextCommand: { text: 'private' } },
        metadata: { timestamp: 1200, duration: 500, status: 'COMPLETED' },
      },
    ],
    1000,
  );
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].commandStartMs, 200);
  assert.ok(!JSON.stringify(timeline).includes('private'));
  assert.ok(!JSON.stringify(timeline).includes('secret'));
});

test('сбой восстановления одного ключа не мешает восстановить другой', () => {
  const calls = [];
  assert.throws(
    () =>
      restoreSettings('phone', { show_touches: '1', pointer_location: '0' }, (_serial, args) => {
        calls.push(args);
        if (args.includes('show_touches')) throw new Error('disconnect');
      }),
    /disconnect/,
  );
  assert.equal(calls.length, 2);
});
