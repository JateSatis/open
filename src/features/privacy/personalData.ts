// Признаки личных данных в тексте, который увидят все: телефон, почта,
// адрес, школа и класс, геолокация, регулярное расписание, ники в других
// соцсетях. Это подсказка человеку перед публикацией, не модерация: ничего
// не отправляется и не хранится, отправку ничто не запрещает.
//
// Найденное — диапазоны в code points, как у скрытого текста в базе: «Скрыть
// найденное от зрителей» кладёт их в сообщение как есть.
//
// Русский и английский. Слова ищутся по границам букв (`\b` в JS не знает
// кириллицы), числа — по границам цифр. Ложные срабатывания дороже
// пропусков: подсказка, которая мигает на «дома скучно», быстро перестаёт
// читаться.

import { toCodePointOffset } from '@/features/chats/fragments/textOffsets';

export type PersonalDataKind =
  | 'phone'
  | 'email'
  | 'address'
  | 'school'
  | 'geo'
  | 'schedule'
  | 'social';

export type PersonalDataFinding = {
  kind: PersonalDataKind;
  /** Code points, `[start, end)`. */
  start: number;
  end: number;
  text: string;
};

/**
 * `none` — ничего; `low` — один признак, подсказка над полем; `high` — адрес,
 * геолокация, школа с номером или два разных признака сразу: лист перед
 * отправкой.
 */
export type PersonalDataRisk = 'none' | 'low' | 'high';

export type PersonalDataScan = {
  findings: PersonalDataFinding[];
  risk: PersonalDataRisk;
};

export const PERSONAL_DATA_LABELS: Record<PersonalDataKind, string> = {
  phone: 'Телефон',
  email: 'Почта',
  address: 'Адрес',
  school: 'Школа или класс',
  geo: 'Геолокация',
  schedule: 'Где и когда вас найти',
  social: 'Аккаунт в другой соцсети',
};

/** Не буква и не цифра слева — начало слова. */
const W_START = '(?<![\\p{L}\\p{N}_])';
/** Не буква и не цифра справа — конец слова. */
const W_END = '(?![\\p{L}\\p{N}_])';

function word(body: string): string {
  return `${W_START}(?:${body})${W_END}`;
}

type Match = { kind: PersonalDataKind; start: number; end: number; strong: boolean };

function scanAll(text: string, pattern: RegExp, visit: (m: RegExpExecArray) => Match | null): Match[] {
  const found: Match[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }

    const hit = visit(m);

    if (hit) found.push(hit);
  }

  return found;
}

function plain(kind: PersonalDataKind, strong: boolean) {
  return (m: RegExpExecArray): Match => ({ kind, start: m.index, end: m.index + m[0].length, strong });
}

// --- Телефон ---------------------------------------------------------------

/** Цифры с разделителями, начинается с «+» или цифры, кончается цифрой. */
const PHONE = new RegExp(`(?<![\\p{L}\\p{N}_.:/])\\+?\\d[\\d\\s\\-().]{8,20}\\d(?![\\p{N}.:/])`, 'u');

function phones(text: string): Match[] {
  return scanAll(text, PHONE, (m) => {
    const digits = m[0].replace(/\D/g, '');

    // 10–13 цифр: номер с кодом страны или без. Меньше — дата, сумма; больше —
    // карта или счёт.
    if (digits.length < 10 || digits.length > 13) return null;
    // Год-месяц-день, разделённые точками: «2026.10.23» — не телефон.
    if (/^\d{4}[.\-/]\d{2}[.\-/]\d{2}/.test(m[0])) return null;
    // Без «+» и без скобок и дефисов сплошная простыня цифр — скорее номер
    // заказа: телефоном её признаём, только если она начинается как номер.
    if (!/[+()\-\s]/.test(m[0]) && !/^(?:7|8|1)\d{9,10}$/.test(digits)) return null;

    return { kind: 'phone', start: m.index, end: m.index + m[0].length, strong: false };
  });
}

// --- Почта -----------------------------------------------------------------

const EMAIL = /(?<![\p{L}\p{N}_.+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}])/u;

// --- Геолокация ------------------------------------------------------------

const COORDINATES = /(?<![\p{N}.])-?\d{1,2}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}(?![\p{N}])/u;

const MAP_LINK = new RegExp(
  [
    '(?:https?:\\/\\/)?(?:www\\.)?',
    '(?:maps\\.google\\.[a-z.]+|google\\.[a-z.]+\\/maps|goo\\.gl\\/maps|maps\\.app\\.goo\\.gl',
    '|yandex\\.[a-z]+\\/maps|maps\\.yandex\\.[a-z]+|yandex\\.[a-z]+\\/-\\/',
    '|2gis\\.[a-z]+|go\\.2gis\\.com|maps\\.apple\\.com|(?:www\\.)?openstreetmap\\.org|osm\\.org\\/go)',
    '[^\\s]*',
  ].join(''),
  'iu',
);

// --- Адрес -----------------------------------------------------------------

/** Тип улицы: полный или сокращённый. */
const STREET_TYPE = [
  'ул\\.?',
  'улиц[аеуыи]',
  'пр-?т\\.?',
  'просп\\.?',
  'проспект[аеу]?',
  'пер\\.?',
  'переул(?:ок|ке|ка)',
  'б-р',
  'бульвар[аеу]?',
  'ш\\.',
  'шоссе',
  'наб\\.?',
  'набережн(?:ая|ой|ую)',
  'пл\\.',
  'площад(?:ь|и)',
  'мкр\\.?',
  'микрорайон[аеу]?',
  'проезд[аеу]?',
  'тупик[аеу]?',
].join('|');

/** Название улицы: одно-два слова, первое с заглавной или числительное («3-я»). */
const STREET_NAME = "(?:\\d{1,2}-?(?:я|й|ая|ий|ой)\\s+)?[\\p{Lu}][\\p{L}'’\\-]+(?:\\s+[\\p{Lu}][\\p{L}'’\\-]+)?";

/** Номер дома: «5», «5а», «5/2», «д. 5», «5 к2», «5 корп. 1», «5 стр 3». */
const HOUSE =
  '(?:д(?:ом)?\\.?\\s*)?\\d{1,4}(?:\\s?[а-яa-z](?![\\p{L}]))?(?:\\s*\\/\\s*\\d{1,3})?(?:\\s*,?\\s*(?:к|корп(?:ус)?|стр(?:оение)?)\\.?\\s*\\d{1,3})?';

/** «ул. Ленина 5», «Ленина ул., д. 5», «проспект Мира, 12к1». */
const STREET_WITH_TYPE = new RegExp(
  `${W_START}(?:(?:${STREET_TYPE})\\s*${STREET_NAME}|${STREET_NAME}\\s+(?:${STREET_TYPE}))\\s*,?\\s*${HOUSE}${W_END}`,
  'u',
);

/** Без типа улицы, но после «живу на», «адрес:»: «живу на Ленина 5». */
const STREET_AFTER_HOME_WORD = new RegExp(
  `${W_START}(?:живу|живём|живем|живет|живёт|проживаю|переехал[аи]?|переехали|мой адрес|наш адрес|адрес)\\s*:?\\s*(?:на|по|в)?\\s*(${STREET_NAME}\\s*,?\\s*${HOUSE})${W_END}`,
  'iu',
);

/** Номер дома словом: «дом 5», «д. 12» — без номера («дома скучно») ничего. */
const HOUSE_WORD = new RegExp(word('(?:дом|д\\.)\\s*№?\\s*\\d{1,4}(?:\\s?[а-я](?![\\p{L}]))?'), 'iu');

const APARTMENT = new RegExp(
  word('(?:кв\\.?|квартир[аеуы]|apt\\.?|apartment)\\s*№?\\s*\\d{1,4}'),
  'iu',
);

const ENTRANCE = new RegExp(
  word('(?:подъезд|под\\.)\\s*№?\\s*\\d{1,2}|\\d{1,2}-?(?:й|ый|ой)?\\s+подъезд(?:е|а)?'),
  'iu',
);

const EN_STREET = new RegExp(
  word('\\d{1,5}\\s+(?:[A-Z][a-z]+\\s+){1,2}(?:Street|St\\.?|Avenue|Ave\\.?|Road|Rd\\.?|Lane|Ln\\.?|Boulevard|Blvd\\.?|Drive|Dr\\.?|Court|Ct\\.?|Place|Pl\\.?)'),
  'u',
);

// --- Школа и класс ---------------------------------------------------------

const SCHOOL_WORD =
  'школ(?:а|е|у|ы|ой|ою)|гимнази(?:я|и|ю|ей)|лице(?:й|я|ю|е|ем)|school|gymnasium|lyceum';

const SCHOOL_NUMBER = new RegExp(
  word(
    `(?:${SCHOOL_WORD})\\s*(?:№|N|No\\.?|#|номер)?\\s*\\d{1,4}` +
      `|\\d{1,4}\\s*-?\\s*(?:я|ая|ой|ую|й|th|st|nd|rd)?\\s+(?:${SCHOOL_WORD})` +
      `|№\\s*\\d{1,4}\\s+(?:${SCHOOL_WORD})`,
  ),
  'iu',
);

/**
 * Класс: «7Б», «11а класс», «в 5 «В»», «7th grade». Голое «7б» строчной
 * буквой без слова «класс» не считаем: «5 в парке» и «3б» в номере
 * квартиры встречаются чаще.
 */
const CLASS = new RegExp(
  word(
    '(?:[1-9]|1[01])\\s?[«"]?[А-ЕЁ][»"]?(?![\\p{L}])' +
      '|(?:[1-9]|1[01])\\s?[«"]?[а-еА-Е]?[»"]?\\s+класс(?:а|е|ом)?' +
      '|(?:[1-9]|1[01])-?(?:й|ый|ой)\\s+класс(?:а|е|ом)?' +
      '|(?:[1-9]|1[0-2])(?:st|nd|rd|th)\\s+grade|grade\\s+(?:[1-9]|1[0-2])',
  ),
  'u',
);

// --- Расписание ------------------------------------------------------------

const DAY =
  'понедельник(?:ам|а|е)?|вторник(?:ам|а|е)?|сред(?:а|у|ам|е)|четверг(?:ам|а|е)?|пятниц(?:а|у|ам|е)|суббот(?:а|у|ам|е)|воскресень(?:е|ям|я)' +
  '|пн|вт|ср|чт|пт|сб|вс|будн(?:и|ям|ий)|выходн(?:ые|ым)' +
  '|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weekdays';

const EVERY = 'каждый|каждую|каждое|каждые|каждого|ежедневно|every|по';

const TIME = '(?:в|к|с|до|at|from)?\\s*(?:[01]?\\d|2[0-3])[:.][0-5]\\d|(?:в|к|с|at)\\s+(?:[01]?\\d|2[0-3])(?:\\s*(?:ч(?:ас(?:а|ов)?)?\\.?|утра|вечера|дня|am|pm))?';

/** Место: предлог места + слово, или «в/на» + узнаваемое место. */
const PLACE =
  '(?:у|возле|около|рядом\\s+с|напротив|перед|за|near|outside|by)\\s+[\\p{L}\\-]{3,}(?:\\s+[\\p{L}\\-]{2,})?' +
  '|(?:в|на|at|in)\\s+(?:школ|секци|бассейн|парк|спортзал|зал|кружк|кружок|тренировк|музыкалк|студи|клуб|библиотек|остановк|метро|двор|площадк|стадион|кафе|торгов|тц|подъезд|school|gym|park|pool|club|library|station)[\\p{L}\\-]*(?:\\s+[\\p{L}\\-]{2,})?';

const SCHEDULE = new RegExp(
  `${W_START}(?:(?:${EVERY})\\s+)?(?:${DAY})${W_END}[^.!?\\n]{0,30}?${W_START}(?:${TIME})${W_END}[^.!?\\n]{0,30}?${W_START}(?:${PLACE})${W_END}`,
  'iu',
);

// --- Соцсети ---------------------------------------------------------------

const SOCIAL_LINK = new RegExp(
  '(?:https?:\\/\\/)?(?:www\\.|m\\.)?(?:vk\\.com|vk\\.ru|t\\.me|telegram\\.me|instagram\\.com|instagr\\.am|tiktok\\.com|facebook\\.com|fb\\.com|twitter\\.com|x\\.com|youtube\\.com\\/@|ok\\.ru|snapchat\\.com|discord\\.gg|threads\\.net|twitch\\.tv)\\/[^\\s]+',
  'iu',
);

const NETWORK =
  'инст(?:а|у|е|ы|ой)?|инстаграм(?:а|е|у|ом)?|insta(?:gram)?|ig|тг|телег(?:а|е|у|рам|раме|рамм|рамме)?|tg|telegram|вк|вконтакте|vk|тикток(?:е|а)?|tiktok|снап(?:чат)?|snap(?:chat)?|дискорд(?:е|а)?|discord|твиттер(?:е|а)?|twitter|фейсбук(?:е|а)?|facebook|twitch|твич(?:е|а)?';

/** «инст @masha_01», «тг: max99», «discord: lol#1234». */
const SOCIAL_NICK = new RegExp(
  `${W_START}(?:${NETWORK})${W_END}\\s*(?:[:\\-—]\\s*)?(@?[A-Za-z0-9_.]{3,32}(?:#\\d{4})?)(?![\\p{L}\\p{N}_])`,
  'iu',
);

function socialNicks(text: string): Match[] {
  return scanAll(text, SOCIAL_NICK, (m) => {
    const nick = m[1];
    const separated = /[:\-—]/.test(m[0].slice(0, m[0].length - nick.length));

    // Ник отличаем от английского слова: «@», двоеточие перед ним или цифры,
    // подчёркивание, точка внутри. «insta account» — не ник.
    if (!nick.startsWith('@') && !separated && !/[\d_.]/.test(nick)) return null;

    return { kind: 'social', start: m.index, end: m.index + m[0].length, strong: false };
  });
}

// --- Сборка ----------------------------------------------------------------

function findAll(text: string): Match[] {
  const matches: Match[] = [
    ...phones(text),
    ...scanAll(text, EMAIL, plain('email', false)),
    ...scanAll(text, COORDINATES, plain('geo', true)),
    ...scanAll(text, MAP_LINK, plain('geo', true)),
    ...scanAll(text, STREET_WITH_TYPE, plain('address', true)),
    ...scanAll(text, STREET_AFTER_HOME_WORD, (m) => {
      const street = m[1];
      const at = m.index + m[0].length - street.length;

      return { kind: 'address', start: at, end: at + street.length, strong: true };
    }),
    ...scanAll(text, HOUSE_WORD, plain('address', true)),
    ...scanAll(text, APARTMENT, plain('address', true)),
    ...scanAll(text, ENTRANCE, plain('address', true)),
    ...scanAll(text, EN_STREET, plain('address', true)),
    ...scanAll(text, SCHOOL_NUMBER, plain('school', true)),
    ...scanAll(text, CLASS, plain('school', false)),
    ...scanAll(text, SCHEDULE, plain('schedule', false)),
    ...scanAll(text, SOCIAL_LINK, plain('social', false)),
    ...socialNicks(text),
  ];

  return merge(text, matches);
}

/** Сильнее — тот, что важнее показать в списке, если куски пересеклись. */
const PRIORITY: PersonalDataKind[] = ['geo', 'address', 'school', 'phone', 'email', 'schedule', 'social'];

/**
 * Пересекающиеся куски — один. Соседние части адреса через запятую или
 * пробел («Ленина 5, кв 12», «дом 5, подъезд 2») — тоже один: скрывать и
 * показывать их по отдельности бессмысленно.
 */
function merge(text: string, matches: Match[]): Match[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Match[] = [];

  for (const next of sorted) {
    const last = merged[merged.length - 1];
    const gap = last ? text.slice(last.end, next.start) : '';
    const touching =
      last &&
      (next.start < last.end ||
        (last.kind === 'address' && next.kind === 'address' && /^[\s,;]*$/.test(gap)));

    if (last && touching) {
      const kind =
        PRIORITY.indexOf(next.kind) < PRIORITY.indexOf(last.kind) ? next.kind : last.kind;

      merged[merged.length - 1] = {
        kind,
        start: last.start,
        end: Math.max(last.end, next.end),
        strong: last.strong || next.strong,
      };
    } else {
      merged.push(next);
    }
  }

  return merged;
}

/** Признаки личных данных в тексте и общий уровень риска. */
export function scanPersonalData(text: string): PersonalDataScan {
  if (!text.trim()) return { findings: [], risk: 'none' };

  const matches = findAll(text);

  if (matches.length === 0) return { findings: [], risk: 'none' };

  const kinds = new Set(matches.map((m) => m.kind));
  const risk: PersonalDataRisk = matches.some((m) => m.strong) || kinds.size >= 2 ? 'high' : 'low';

  return {
    risk,
    findings: matches.map((m) => ({
      kind: m.kind,
      start: toCodePointOffset(text, m.start),
      end: toCodePointOffset(text, m.end),
      text: text.slice(m.start, m.end),
    })),
  };
}
