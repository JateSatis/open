import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceSelection, resolveDevices } from './device-selection.mjs';

const phone = { serial: 'phone', state: 'device' };
const emulator = { serial: 'emulator-5554', state: 'device' };
function environment(devices = []) {
  const events = [];
  return {
    events,
    list: () => devices,
    avdName: (serial) => {
      events.push(`name:${serial}`);
      return 'open_test';
    },
    start: async (avd) => {
      events.push(`start:${avd}`);
    },
    ready: async (avd) => {
      events.push(`ready:${avd}`);
      return emulator.serial;
    },
  };
}

test('по умолчанию и с --phone выбирается только телефон, без обращения к эмуляторам', async () => {
  for (const flags of [{}, { phone: true }]) {
    const io = environment([phone, emulator]);
    assert.deepEqual(await resolveDevices(deviceSelection(flags), io, { startMissing: true }), [
      'phone',
    ]);
    assert.deepEqual(io.events, []);
  }
});

test('--emulator переиспользует запущенный AVD, --both выбирает оба устройства', async () => {
  for (const [flags, expected] of [
    [{ emulator: true }, [emulator.serial]],
    [{ both: true }, ['phone', emulator.serial]],
  ]) {
    const io = environment([phone, emulator]);
    assert.deepEqual(
      await resolveDevices(deviceSelection(flags), io, { startMissing: true }),
      expected,
    );
    assert.ok(!io.events.some((event) => event.startsWith('start:')));
  }
});

test('только up с явным выбором эмулятора может запустить недостающий AVD', async () => {
  for (const flags of [{ emulator: true }, { both: true }]) {
    const io = environment([phone]);
    await resolveDevices(deviceSelection(flags), io, { startMissing: true });
    assert.deepEqual(io.events, ['start:open_test', 'ready:open_test']);
    const resetIo = environment([phone]);
    await assert.rejects(resolveDevices(deviceSelection(flags), resetIo), /Reset не запускает/);
    assert.deepEqual(resetIo.events, []);
  }
});

test('нет телефона или нет разрешения: ошибка до любого запуска эмулятора', async () => {
  for (const devices of [[], [emulator], [{ ...phone, state: 'unauthorized' }]]) {
    const io = environment(devices);
    await assert.rejects(
      resolveDevices(deviceSelection({ both: true }), io, { startMissing: true }),
      (error) => error.exitCode === 4,
    );
    assert.deepEqual(io.events, []);
  }
});

test('offline-эмулятор не порождает ещё один экземпляр', async () => {
  const io = environment([{ ...emulator, state: 'offline' }]);
  await assert.rejects(
    resolveDevices(deviceSelection({ emulator: true }), io, { startMissing: true }),
    /неготовый/,
  );
  assert.deepEqual(io.events, []);
});

test('точный serial не запускает и не выбирает соседние устройства', async () => {
  const io = environment([phone, emulator]);
  assert.deepEqual(
    await resolveDevices(deviceSelection({ serial: emulator.serial }), io, { startMissing: true }),
    [emulator.serial],
  );
  await assert.rejects(resolveDevices(deviceSelection({ serial: 'missing' }), io), /не подключён/);
  assert.deepEqual(io.events, []);
});

test('неоднозначные режимы и несколько телефонов отклоняются', async () => {
  for (const flags of [
    { phone: true, emulator: true },
    { both: true, phone: true },
    { serial: 'phone', both: true },
  ]) {
    assert.throws(() => deviceSelection(flags), /Выбери одно/);
  }
  await assert.rejects(
    resolveDevices(deviceSelection(), environment([phone, { ...phone, serial: 'other' }])),
    /Несколько телефонов/,
  );
});
