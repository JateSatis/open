// Даты по-русски коротко: «3 окт», «вчера в 9:40». Часы без ведущего нуля —
// так пишут люди, а не часы на табло.

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** «9:40», «16:10». */
export function formatClock(date: Date): string {
  return `${date.getHours()}:${pad(date.getMinutes())}`;
}

/** «3 окт», в другом году — «3 окт 2024». */
export function formatShortDate(date: Date, now: Date = new Date()): string {
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;

  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** «23 июн в 14:16». */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);

  return `${formatShortDate(date, now)} в ${formatClock(date)}`;
}

/**
 * «был(а) в 16:10», «был(а) вчера в 9:40», «был(а) 3 окт». Без отметки —
 * «был(а) давно»: человек ни разу не отмечался. Род нейтральный: пола у
 * профиля нет.
 */
export function formatLastSeen(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'был(а) давно';

  const date = new Date(iso);

  if (sameDay(date, now)) return `был(а) в ${formatClock(date)}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(date, yesterday)) return `был(а) вчера в ${formatClock(date)}`;

  return `был(а) ${formatShortDate(date, now)}`;
}

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «12 марта 2008» из `YYYY-MM-DD` — без часовых поясов: это день, а не момент. */
export function formatDateOnly(value: string): string {
  const [year, month, day] = value.split('-').map(Number);

  return `${day} ${MONTHS_GENITIVE[month - 1]} ${year}`;
}

/** «06.11», за прошлые годы — «06.11.25». */
export function formatDayMonth(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;

  return date.getFullYear() === now.getFullYear() ? day : `${day}.${pad(date.getFullYear() % 100)}`;
}
