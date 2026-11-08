// Bind an installed APK to EAS build provenance, then compare native fingerprints.
// No build is submitted automatically. Unknown provenance is not evidence of incompatibility.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createFingerprintAsync } from 'expo/fingerprint.js';
import { ROOT, STATE, APP_ID, command, packageInfo } from './dev-runtime.mjs';

export async function currentFingerprint() {
  // Let Expo enumerate all native inputs; a hand-written cache can miss plugin/env changes.
  const fingerprint = await createFingerprintAsync(ROOT, { platforms: ['android'], silent: true });
  return fingerprint.hash;
}

const recordPath = (serial) =>
  join(STATE, `installed-${createHash('sha256').update(serial).digest('hex').slice(0, 16)}.json`);

export function compareBuild(record, info, current) {
  if (!record || JSON.stringify(record.installed) !== JSON.stringify(info))
    return { status: 'unknown', reason: 'нет записи об этой установке APK' };
  if (!record.fingerprint)
    return {
      status: 'unknown',
      buildId: record.buildId,
      reason: 'EAS не сохранил fingerprint сборки',
    };
  return {
    status: record.fingerprint === current ? 'compatible' : 'changed',
    buildId: record.buildId,
    fingerprint: record.fingerprint,
    current,
  };
}

export async function installedCompatibility(serial, info, current) {
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath(serial), 'utf8'));
  } catch {
    return compareBuild(null, info);
  }
  if (JSON.stringify(record.installed) !== JSON.stringify(info) || !record.fingerprint)
    return compareBuild(record, info);
  return compareBuild(record, info, current ?? (await currentFingerprint()));
}

export function validateBuild(build, projectId) {
  if (
    build.status !== 'FINISHED' ||
    build.platform !== 'ANDROID' ||
    build.appIdentifier !== APP_ID ||
    build.app?.id !== projectId
  ) {
    throw new Error('Нужна завершённая Android-сборка этого приложения и EAS-проекта.');
  }
  const url = build.artifacts?.applicationArchiveUrl ?? build.artifacts?.buildUrl;
  if (!url?.startsWith('https:') || !new URL(url).pathname.endsWith('.apk'))
    throw new Error('У сборки нет HTTPS APK-артефакта.');
  return url;
}

export function installedApkPath(output) {
  const paths = output.trim().split(/\r?\n/);
  if (paths.length !== 1 || !/^package:\/[\w/+=.~\-]+\.apk$/.test(paths[0])) {
    throw new Error('Не удалось проверить единственный APK установленного приложения.');
  }
  return paths[0].slice(8);
}

async function main() {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args.splice(index, 2)[1];
  };
  const serial = take('-s') ?? process.env.ANDROID_SERIAL;
  const buildId = take('--build');
  const mode = args[0];
  if (!serial || !['status', 'install'].includes(mode))
    throw new Error(
      'Usage: node scripts/dev-build.mjs status -s SERIAL | install -s SERIAL --build EAS_BUILD_ID',
    );
  if (mode === 'status') {
    const installed = packageInfo(serial);
    const current = await currentFingerprint();
    console.log(
      JSON.stringify(
        {
          serial,
          installed,
          currentFingerprint: current,
          compatibility: await installedCompatibility(serial, installed, current),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!/^[a-f0-9-]{36}$/i.test(buildId ?? ''))
    throw new Error('Укажи точный EAS build ID через --build.');
  const output =
    process.platform === 'win32'
      ? command('cmd.exe', ['/d', '/s', '/c', `eas build:view ${buildId} --json`], {
          timeout: 60000,
        })
      : command('eas', ['build:view', buildId, '--json'], { timeout: 60000 });
  const build = JSON.parse(output);
  const projectId = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo.extra.eas
    .projectId;
  const url = validateBuild(build, projectId);
  mkdirSync(STATE, { recursive: true });
  const apk = join(STATE, `${buildId}.apk`);
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`APK: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(apk));
  const sha256 = createHash('sha256').update(readFileSync(apk)).digest('hex');
  command('adb', ['-s', serial, 'install', '-r', apk], { timeout: 180000 });
  const installed = packageInfo(serial);
  if (installed.versionCode !== String(build.appBuildVersion))
    throw new Error('Версия установленного приложения не совпала с выбранной сборкой.');
  const apkPath = installedApkPath(command('adb', ['-s', serial, 'shell', 'pm', 'path', APP_ID]));
  const remoteHash = command('adb', ['-s', serial, 'shell', 'sha256sum', apkPath])
    .trim()
    .split(/\s/)[0];
  if (remoteHash !== sha256)
    throw new Error('SHA-256 установленного APK не совпал с артефактом EAS.');
  writeFileSync(
    recordPath(serial),
    JSON.stringify(
      { buildId, sha256, fingerprint: build.fingerprint?.hash ?? null, installed },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { serial, buildId, compatibility: await installedCompatibility(serial, installed) },
      null,
      2,
    ),
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
