import { scanPersonalData, type PersonalDataKind } from './personalData';

function kinds(text: string): PersonalDataKind[] {
  return scanPersonalData(text).findings.map((f) => f.kind);
}

function found(text: string): string[] {
  return scanPersonalData(text).findings.map((f) => f.text);
}

describe('scanPersonalData', () => {
  describe('телефон и почта — подсказка', () => {
    it.each([
      'мой телефон +7 999 123-45-67',
      'звони 8 (999) 123 45 67',
      'номер 89991234567',
      'call me at +1 (415) 555-0132',
    ])('%s', (text) => {
      const scan = scanPersonalData(text);

      expect(scan.risk).toBe('low');
      expect(kinds(text)).toEqual(['phone']);
    });

    it('почта', () => {
      expect(scanPersonalData('пиши на masha.k@mail.ru').risk).toBe('low');
      expect(found('пиши на masha.k@mail.ru')).toEqual(['masha.k@mail.ru']);
    });

    it('не телефон: даты, суммы, время, номер заказа, карта', () => {
      for (const text of [
        'встреча 23.10.2026 в 15:00',
        'заплатил 1 500 000 рублей',
        'с 10:00 до 18:00',
        'заказ 12345678',
        'карта 4276 1234 5678 9012',
        'пи — это 3.14159265358',
      ]) {
        expect(kinds(text)).toEqual([]);
      }
    });
  });

  describe('адрес — лист', () => {
    it('«живу на Ленина 5, кв 12» — один адрес, высокий риск', () => {
      const scan = scanPersonalData('живу на Ленина 5, кв 12');

      expect(scan.risk).toBe('high');
      expect(found('живу на Ленина 5, кв 12')).toEqual(['Ленина 5, кв 12']);
    });

    it.each([
      ['ул. Пушкина, д. 10', 'ул. Пушкина, д. 10'],
      ['мы на проспекте Мира 12к1', 'проспекте Мира 12к1'],
      ['улица Гагарина 3а', 'улица Гагарина 3а'],
      ['дом 5, подъезд 2', 'дом 5, подъезд 2'],
      ['заходи, 3 подъезд', '3 подъезд'],
      ['I live at 221 Baker Street', '221 Baker Street'],
      ['apt 4 is mine', 'apt 4'],
    ])('%s', (text, piece) => {
      expect(scanPersonalData(text).risk).toBe('high');
      expect(found(text)).toEqual([piece]);
    });

    it('без номера — не адрес', () => {
      for (const text of [
        'дома скучно',
        'иду домой',
        'на улице холодно',
        'живу в Москве',
        'дом большой',
        'в квартире тепло',
        'Ленина читали?',
      ]) {
        expect(kinds(text)).toEqual([]);
      }
    });
  });

  describe('школа и класс', () => {
    it('«школа 57, 7Б, каждый вторник в 15:00 у входа» — три пункта, лист', () => {
      const text = 'школа 57, 7Б, каждый вторник в 15:00 у входа';
      const scan = scanPersonalData(text);

      expect(scan.risk).toBe('high');
      expect(scan.findings.map((f) => [f.kind, f.text])).toEqual([
        ['school', 'школа 57'],
        ['school', '7Б'],
        ['schedule', 'каждый вторник в 15:00 у входа'],
      ]);
    });

    it.each(['учусь в гимназии № 3', 'в 57 школе', 'лицей 1535', 'go to school #12'])(
      'школа с номером: %s',
      (text) => {
        expect(kinds(text)).toEqual(['school']);
        expect(scanPersonalData(text).risk).toBe('high');
      },
    );

    it('класс без школы — подсказка', () => {
      expect(scanPersonalData('я из 7Б').risk).toBe('low');
      expect(scanPersonalData('учусь в 9 классе').risk).toBe('low');
    });

    it('школа без номера и «в 5» — ничего', () => {
      for (const text of ['в школе сегодня тест', 'школа надоела', 'встретимся в 5', '5 в ряд', 'класс!']) {
        expect(kinds(text)).toEqual([]);
      }
    });
  });

  describe('расписание', () => {
    it('день, время и место', () => {
      expect(kinds('по средам в 18:30 в бассейне на Мира')).toEqual(['schedule']);
      expect(kinds('every Monday at 7:00 near the gym')).toEqual(['schedule']);
    });

    it('время без места или без дня — ничего', () => {
      for (const text of [
        'каждый вторник в 15:00',
        'в 15:00 у входа',
        'в понедельник созвонимся',
        'встретимся в 5',
      ]) {
        expect(kinds(text)).toEqual([]);
      }
    });
  });

  describe('геолокация', () => {
    it('координаты и ссылки на карты', () => {
      expect(kinds('я тут 55.75580, 37.61730')).toEqual(['geo']);
      expect(kinds('вот https://yandex.ru/maps/-/CDdXyZ')).toEqual(['geo']);
      expect(kinds('https://maps.app.goo.gl/abc123')).toEqual(['geo']);
      expect(scanPersonalData('https://go.2gis.com/xyz').risk).toBe('high');
    });

    it('обычные дроби — не координаты', () => {
      expect(kinds('курс 95.5, рост 1.2')).toEqual([]);
    });
  });

  describe('соцсети', () => {
    it.each(['мой инст @masha_01', 'тг: max99', 'vk.com/id12345', 'пиши в телеге @lena'])('%s', (text) => {
      expect(kinds(text)).toEqual(['social']);
      expect(scanPersonalData(text).risk).toBe('low');
    });

    it('упоминание сети без ника — ничего', () => {
      for (const text of ['инста скучная', 'в тг сегодня тихо', 'insta account is fun', 'видел в тиктоке']) {
        expect(kinds(text)).toEqual([]);
      }
    });
  });

  it('два разных признака — высокий риск', () => {
    expect(scanPersonalData('тел +7 999 123-45-67, тг: max99').risk).toBe('high');
  });

  it('диапазоны — в code points', () => {
    const text = '😀 кв 12';
    const [finding] = scanPersonalData(text).findings;

    expect(finding).toMatchObject({ start: 2, end: 7, text: 'кв 12' });
  });

  it('пустой текст', () => {
    expect(scanPersonalData('   ')).toEqual({ findings: [], risk: 'none' });
  });
});
