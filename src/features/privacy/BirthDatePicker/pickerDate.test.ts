import { fromPickerValue, toPickerValue } from './pickerDate';

describe('день рождения в нативном выборе (iOS — местный календарь)', () => {
  it('туда и обратно — тот же день', () => {
    expect(fromPickerValue(toPickerValue('2008-03-12'))).toBe('2008-03-12');
  });

  it('открывается на местном дне, а не на соседнем по UTC', () => {
    const value = toPickerValue('2008-03-12');

    expect([value.getFullYear(), value.getMonth(), value.getDate()]).toEqual([2008, 2, 12]);
  });
});
