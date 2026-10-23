import { hiddenActionFor } from './hideSelection';

import type { TextSelection } from '@/features/chats/fragments/fragmentStore';
import { registerSelectableText } from '@/features/chats/fragments/selectableTexts';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

const TEXT = 'учусь: ••••••••, класс 7Б';

function selection(start: number, end: number, amMember: boolean): TextSelection {
  return {
    rowKey: 'row',
    messageId: 'm1',
    chatId: 'c1',
    amMember,
    text: TEXT,
    start,
    end,
    geometry: {
      text: TEXT,
      width: 0,
      height: 0,
      lines: [],
    } as unknown as TextSelection['geometry'],
    textInRow: { x: 0, y: 0 },
    textInWindow: { x: 0, y: 0 },
    dragging: null,
  };
}

function register(canHide: boolean) {
  return registerSelectableText('row', {
    ref: { current: null },
    text: TEXT,
    messageId: 'm1',
    chatId: 'c1',
    amMember: false,
    hiddenRanges: [{ start: 7, end: 15 }],
    canHide,
  });
}

describe('hiddenActionFor', () => {
  it('К1.6 зритель выделил кусок, задевающий скрытое, — нельзя', () => {
    const release = register(false);

    expect(hiddenActionFor(selection(13, 21, false))).toBe('blocked');
    expect(hiddenActionFor(selection(17, 22, false))).toBe('none');
    release();
  });

  it('К1.2, К1.7 автор: открытое — скрыть, скрытое — показать', () => {
    const release = register(true);

    expect(hiddenActionFor(selection(17, 22, true))).toBe('hide');
    expect(hiddenActionFor(selection(7, 15, true))).toBe('show');
    release();
  });

  it('К1.7 участник в чужом сообщении скрывать не может', () => {
    const release = register(false);

    expect(hiddenActionFor(selection(17, 22, true))).toBe('none');
    release();
  });
});
