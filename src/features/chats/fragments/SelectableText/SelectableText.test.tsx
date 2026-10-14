import { act, render, screen } from '@testing-library/react-native';

import { SelectableText } from '.';

import { exitFragmentMode, setTextSelection } from '@/features/chats/fragments/fragmentStore';
import { selectableTextOf } from '@/features/chats/fragments/selectableTexts';

const geometry = {
  text: 'какой-то другой уровень',
  width: 200,
  height: 20,
  lines: [{ start: 0, end: 23, top: 0, bottom: 20, baseline: 15, left: 0, right: 184 }],
  xs: [...'какой-то другой уровень'].map((_, i) => i * 8),
};

function select(rowKey: string) {
  setTextSelection({
    rowKey,
    messageId: 'm1',
    chatId: 'chat-1',
    amMember: false,
    text: geometry.text,
    start: 9,
    end: 15,
    geometry,
    textInRow: { x: 0, y: 0 },
    textInWindow: { x: 0, y: 0 },
    dragging: null,
  });
}

beforeEach(() => exitFragmentMode());

describe('selectable text of a bubble', () => {
  it('is plain text with no selection', async () => {
    await render(
      <SelectableText
        text={geometry.text}
        isOwn={false}
        rowKey="m1"
        messageId="m1"
        chatId="chat-1"
        amMember={false}
      />,
    );

    expect(screen.getByText(geometry.text)).toBeTruthy();
    expect(screen.queryByTestId('text-selection')).toBeNull();
  });

  it('paints the selection and both handles only in its own bubble', async () => {
    await render(
      <>
        <SelectableText
          text={geometry.text}
          isOwn={false}
          rowKey="m1"
          messageId="m1"
          chatId="chat-1"
          amMember={false}
        />
        <SelectableText
          text="другое"
          isOwn
          rowKey="m2"
          messageId="m2"
          chatId="chat-1"
          amMember={false}
        />
      </>,
    );

    await act(async () => select('m1'));

    expect(screen.getAllByTestId('text-selection')).toHaveLength(1);
    expect(screen.getByTestId('selection-handle-start')).toBeTruthy();
    expect(screen.getByTestId('selection-handle-end')).toBeTruthy();
  });

  it('registers its text for the long press only when it can be selected', async () => {
    const { unmount } = await render(
      <SelectableText
        text={geometry.text}
        isOwn={false}
        rowKey="m1"
        messageId="m1"
        chatId="chat-1"
        amMember
      />,
    );

    expect(selectableTextOf('m1')).toMatchObject({
      messageId: 'm1',
      chatId: 'chat-1',
      amMember: true,
    });

    await unmount();

    expect(selectableTextOf('m1')).toBeUndefined();
  });
});
