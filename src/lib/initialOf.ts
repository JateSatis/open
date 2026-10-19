/**
 * Буква на месте фото: первый символ имени заглавной. Символ — кодовая
 * точка, а не половина суррогатной пары: имя с эмодзи в начале не даёт
 * битого знака. Пустое имя — «?».
 */
export function initialOf(name: string): string {
  const [first] = Array.from(name.trim());

  return first ? first.toUpperCase() : '?';
}
