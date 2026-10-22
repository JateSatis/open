// Непрозрачные id людей. Человек, подменённый для смотрящего в диалоге,
// приходит из базы с id этого чата, а не настоящим (`opaque` в выборках):
// по нему группируются пузыри и различаются участники, но профиля за ним нет,
// и «в сети» по нему не спросить. Разбор выборок запоминает такие id здесь,
// чтобы экраны не пытались открыть по ним профиль. Id — HMAC сервера, с
// настоящими они не совпадают.

const opaqueIds = new Set<string>();

/** Запомнить id как непрозрачный, если база так его пометила. */
export function rememberPersonId(id: string | null | undefined, opaque: boolean | null | undefined): void {
  if (id && opaque) opaqueIds.add(id);
}

/** Id подменённого в диалоге человека: профиль по нему не открывается. */
export function isOpaquePersonId(id: string | null | undefined): boolean {
  return !!id && opaqueIds.has(id);
}

/** Признак `opaque` из выборки — запомнив id, если он непрозрачный. */
export function opaqueFlag(id: string | null | undefined, opaque: boolean | null | undefined): boolean {
  rememberPersonId(id, opaque);

  return opaque === true;
}
