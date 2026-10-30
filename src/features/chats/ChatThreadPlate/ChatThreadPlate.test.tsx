import { fireEvent, render, screen } from '@testing-library/react-native';

import { ChatThreadPlate } from '.';

import type { ChatThreadSummary } from '@/api/chats';

jest.mock('@/hooks/use-avatar-source', () => ({ useAvatarSource: () => null }));

const summary: ChatThreadSummary = {
  rootId: 'root-1',
  repliesCount: 5,
  last: {
    seq: 10,
    createdAt: new Date().toISOString(),
    preview: {
      kind: 'text',
      text: 'Очень длинный последний ответ, который на плашке не помещается в одну строку',
      thumbnailUrl: null,
      mediaCount: 0,
      firstMediaIsVideo: false,
      durationMs: null,
    },
  },
  people: [
    { id: 'a', name: 'Аня', avatarUrl: null },
    { id: 'b', name: 'Борис', avatarUrl: null },
  ],
  othersCount: 2,
};

describe('ChatThreadPlate', () => {
  it('число ответов, двое последних, «+N» и последний ответ одной строкой', async () => {
    await render(
      <ChatThreadPlate summary={summary} isOwn={false} inset={0} aside={0} onPress={jest.fn()} />,
    );

    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByLabelText('Аня')).toBeTruthy();
    expect(screen.getByLabelText('Борис')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();

    const last = screen.getByTestId('chat-thread-plate-last');

    expect(last.props.numberOfLines).toBe(1);
    expect(last.props.children).toMatch(/^\d\d:\d\d • Очень длинный последний ответ/);
  });

  it('тап открывает тред', async () => {
    const onPress = jest.fn();

    await render(
      <ChatThreadPlate summary={summary} isOwn inset={0} aside={0} onPress={onPress} />,
    );
    await fireEvent.press(screen.getByLabelText('Тред: 5 ответов'));

    expect(onPress).toHaveBeenCalled();
  });

  it('без остальных ответивших «+N» нет', async () => {
    await render(
      <ChatThreadPlate
        summary={{ ...summary, othersCount: 0 }}
        isOwn={false}
        inset={0}
        aside={0}
        onPress={jest.fn()}
      />,
    );

    expect(screen.queryByText(/^\+/)).toBeNull();
  });
});
