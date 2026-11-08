// Select lifecycle targets before changing anything. Reset never starts a missing emulator.
const emulatorSerial = (serial) => serial.startsWith('emulator-');
const unavailable = (message, exitCode = 1) => Object.assign(new Error(message), { exitCode });

export function deviceSelection({ phone = false, emulator = false, both = false, serial } = {}) {
  if (
    [phone, emulator, both].filter(Boolean).length > 1 ||
    (serial && (phone || emulator || both))
  ) {
    throw new Error('Выбери одно: --phone, --emulator, --both или -s SERIAL.');
  }
  return serial
    ? { mode: 'serial', serial }
    : { mode: both ? 'both' : emulator ? 'emulator' : 'phone' };
}

export async function resolveDevices(
  selection,
  io,
  { startMissing = false, avd = 'open_test' } = {},
) {
  const devices = io.list();
  if (selection.mode === 'serial') {
    const target = devices.find((d) => d.serial === selection.serial);
    if (target?.state !== 'device')
      throw unavailable(`${selection.serial}: ${target?.state ?? 'не подключён'}.`);
    return [target.serial];
  }
  const targets = [];
  if (selection.mode !== 'emulator') {
    const phones = devices.filter((d) => !emulatorSerial(d.serial));
    if (phones.length > 1) throw unavailable('Несколько телефонов — укажи -s SERIAL.');
    if (!phones.length || phones[0].state !== 'device') {
      throw unavailable(
        phones.length
          ? `Телефон ${phones[0].serial}: ${phones[0].state}. Проверь разрешение отладки по USB.`
          : 'Телефон не подключён. Для эмулятора явно выбери --emulator.',
        4,
      );
    }
    targets.push(phones[0].serial);
  }
  // Phone-only operations do not even query AVD names or boot state.
  if (selection.mode === 'phone') return targets;
  if (!/^[A-Za-z0-9_.-]+$/.test(avd)) throw unavailable('OPEN_AVD: некорректное имя эмулятора.');
  const emulators = devices.filter((d) => emulatorSerial(d.serial));
  const running = emulators.find((d) => d.state === 'device' && io.avdName(d.serial) === avd);
  if (!running) {
    if (!startMissing)
      throw unavailable(
        `Эмулятор ${avd} не запущен. Reset не запускает устройства; используй up --emulator.`,
      );
    if (emulators.some((d) => d.state !== 'device'))
      throw unavailable('Есть неготовый эмулятор; проверь его состояние перед новым запуском.');
    await io.start(avd);
  }
  const ready = await io.ready(avd);
  if (!ready) throw unavailable(`Эмулятор ${avd} не готов; повторного запуска не будет.`);
  targets.push(ready);
  return targets;
}
