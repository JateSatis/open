import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { ROOT, APP_ID, classifyUi, sameRoot } from './dev-runtime.mjs';
import { compareBuild, validateBuild, installedApkPath } from './dev-build.mjs';
import {
  fixtureRequirements,
  fixtureSql,
  checkFixtures,
  cleanupFixtures,
  shouldStopRun,
} from './e2e-prepare.mjs';

test('пустой список и вход не считаются поломкой приложения', () => {
  assert.equal(classifyUi('<node resource-id="tab-bar"/>'), 'ready');
  assert.equal(classifyUi('<node text="Продолжить с Google"/>'), 'sign-in');
  assert.equal(classifyUi('<node text="Render Error"/>'), 'error');
  assert.equal(classifyUi(''), 'unknown');
});

test('Metro другого проекта не считается нашим', () => {
  assert.equal(sameRoot(encodeURI(ROOT)), true);
  assert.equal(sameRoot(join(ROOT, 'different-project')), false);
  assert.equal(sameRoot(null), false);
});

test('совместимость APK требует происхождения именно этой установки', () => {
  const installed = { versionCode: '1', updated: 'today', devClient: true };
  const record = { installed, fingerprint: 'native-A', buildId: 'build' };
  assert.equal(compareBuild(null, installed, 'native-A').status, 'unknown');
  assert.equal(compareBuild(record, installed, 'native-A').status, 'compatible');
  assert.equal(compareBuild(record, installed, 'native-B').status, 'changed');
  assert.equal(
    compareBuild(record, { ...installed, updated: 'tomorrow' }, 'native-A').status,
    'unknown',
  );
  assert.equal(compareBuild({ ...record, fingerprint: null }, installed).status, 'unknown');
});

test('установка отклоняет сборку другого проекта и незавершённую сборку', () => {
  const build = {
    status: 'FINISHED',
    platform: 'ANDROID',
    appIdentifier: APP_ID,
    app: { id: 'project' },
    artifacts: { buildUrl: 'https://example.test/build.apk' },
  };
  assert.equal(validateBuild(build, 'project'), build.artifacts.buildUrl);
  assert.throws(() => validateBuild(build, 'other'));
  assert.throws(() => validateBuild({ ...build, status: 'IN_PROGRESS' }, 'project'));
  assert.throws(() =>
    validateBuild(
      { ...build, artifacts: { buildUrl: 'http://example.test/build.apk' } },
      'project',
    ),
  );
});

test('путь APK учитывает Android /data/app/~~ и отклоняет split APK или shell-символы', () => {
  assert.equal(
    installedApkPath('package:/data/app/~~abc_123==/com.openger.app-xyz==/base.apk\n'),
    '/data/app/~~abc_123==/com.openger.app-xyz==/base.apk',
  );
  assert.throws(() => installedApkPath('package:/base.apk\npackage:/split.apk'));
  assert.throws(() => installedApkPath('package:/base;echo.apk'));
});

test('предпосылки выбираются по сценарию и учитывают -e', () => {
  const flows = [{ id: 'comments-sheet', file: join(ROOT, '.maestro/comments-sheet.yaml') }];
  assert.deepEqual(fixtureRequirements(flows), [
    { table: 'chats', column: 'title', value: 'Plany' },
  ]);
  const requirements = fixtureRequirements(flows, ['-e', "CHAT=O'Brien"]);
  assert.match(fixtureSql(requirements), /O''Brien/);
  assert.match(fixtureSql(requirements), /^BEGIN READ ONLY;/);
  assert.equal(checkFixtures(flows, [], () => 'fixture:0|t').count, 1);
  assert.throws(() => checkFixtures(flows, [], () => 'fixture:0|f'), /Нет тестовых данных/);
  assert.throws(
    () =>
      checkFixtures(flows, [], () => {
        throw new Error('SSH unavailable');
      }),
    /SSH unavailable/,
  );
});

test('уборка атомарна и ошибка транспорта не превращается в успех', () => {
  cleanupFixtures((sql, options) => {
    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /COMMIT;$/);
    assert.match(sql, /statement_timeout/);
    assert.equal(options.timeout, 120000);
    return 'BEGIN\n0|0\nCOMMIT';
  });
  assert.throws(() => cleanupFixtures(() => '1|0'), /без подтверждения/);
  assert.throws(
    () =>
      cleanupFixtures(() => {
        throw new Error('SQL failed');
      }),
    /SQL failed/,
  );
});

test('общий сбой останавливает очередь, обычное единичное падение — нет', () => {
  assert.equal(shouldStopRun({ ok: false, failure: 'device offline' }), true);
  assert.equal(shouldStopRun({ ok: false, infrastructureFailure: true }), true);
  assert.equal(shouldStopRun({ ok: false, failure: 'missing chat' }, 'missing chat'), true);
  assert.equal(shouldStopRun({ ok: false, failure: 'assertion failed' }), false);
  assert.equal(shouldStopRun({ ok: true }), false);
});

test('план Maestro работает без устройства, установки CLI и подключения к БД', () => {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts/maestro.mjs'), '--plan', '.maestro/smoke.yaml'],
    {
      cwd: tmpdir(),
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        ANDROID_SERIAL: 'not-a-device',
        TARGET_SSH_HOST: '',
        TARGET_DB_URL: '',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Выбрано: smoke/);
  assert.doesNotMatch(result.stdout, /Скачиваю|Перезапуск/);
});
