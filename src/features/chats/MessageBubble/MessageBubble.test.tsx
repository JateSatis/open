import { render, screen, userEvent, within } from '@testing-library/react-native';

import { MessageBubble } from '.';

import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import type { ChatMessage } from '@/features/chats/useChatMessages';

jest.mock('@/features/media', () => ({
  MediaViewer: ({ visible }: { visible: boolean }) => {
    const { Text } = require('react-native');
    return visible ? <Text>Просмотр открыт</Text> : null;
  },
  VoicePlayer: ({ uri, playbackKey }: { uri: string; playbackKey: string }) => {
    const { Text } = require('react-native');
    return <Text>{`плеер ${playbackKey} ${uri}`}</Text>;
  },
}));

function textMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: 'привет',
    createdAt: '2026-09-22T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    status: 'sent',
    ...overrides,
  };
}

function mediaMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return textMessage({
    kind: 'media',
    text: null,
    attachments: [
      {
        id: 'att-1',
        url: 'https://cdn.example/a.jpg',
        posterUrl: null,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        durationMs: null,
        waveform: null,
      },
    ],
    ...overrides,
  });
}

const baseProps = {
  isOwn: false,
  isRead: false,
  authorName: 'Марина',
  authorAvatarUrl: null,
  mediaBounds: mosaicBounds(328),
  onRetry: jest.fn(),
};

describe('MessageBubble', () => {
  it('в личном диалоге у чужого облачка нет аватара, но имя автора видно', async () => {
    await render(<MessageBubble {...baseProps} message={textMessage()} showAvatar={false} />);

    expect(screen.queryByLabelText('Профиль: Марина')).toBeNull();
    expect(screen.getByText('Марина')).toBeTruthy();
  });

  it('opens the author profile from the avatar and from the name', async () => {
    const onAuthorPress = jest.fn();
    const user = userEvent.setup();

    await render(
      <MessageBubble message={textMessage()} {...baseProps} onAuthorPress={onAuthorPress} />,
    );
    await user.press(screen.getByLabelText('Профиль: Марина'));
    await user.press(screen.getByText('Марина'));

    expect(onAuthorPress).toHaveBeenCalledTimes(2);
  });

  it('renders plain text as before', async () => {
    await render(<MessageBubble message={textMessage()} {...baseProps} />);

    expect(screen.getByText('привет')).toBeTruthy();
  });

  it('shows the placeholder for attachments the bubble does not render yet', async () => {
    await render(
      <MessageBubble
        message={textMessage({ kind: 'voice', text: null, attachments: [] })}
        {...baseProps}
      />,
    );

    expect(screen.getByText('Вложение')).toBeTruthy();
  });

  it('renders the mosaic in the very first render and opens the viewer on tap', async () => {
    await render(<MessageBubble message={mediaMessage()} {...baseProps} />);

    // Без onLayout: размер мозаики известен сразу, от ширины списка.
    expect(screen.getByTestId('media-mosaic')).toBeTruthy();
    expect(screen.queryByText('Вложение')).toBeNull();

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Открыть фото'));

    expect(screen.getByText('Просмотр открыт')).toBeTruthy();
  });

  it('puts the time on the mosaic when the media has no caption', async () => {
    await render(<MessageBubble message={mediaMessage()} {...baseProps} />);

    expect(within(screen.getByTestId('media-mosaic')).getByTestId('message-meta')).toBeTruthy();
  });

  it('puts the caption and the time under the mosaic, as wide as the mosaic', async () => {
    await render(<MessageBubble message={mediaMessage({ text: 'подпись' })} {...baseProps} />);

    const mosaic = screen.getByTestId('media-mosaic');

    expect(within(mosaic).queryByTestId('message-meta')).toBeNull();
    expect(screen.getByText('подпись')).toBeTruthy();
    expect(screen.getByTestId('message-bubble')).toHaveStyle({
      width: mosaic.props.style.find((style: { width?: number }) => style?.width).width,
    });
  });

  it('keeps the retry control on a failed media message', async () => {
    const onRetry = jest.fn();

    await render(
      <MessageBubble
        message={mediaMessage({ status: 'failed', localId: 'local-1' })}
        {...baseProps}
        isOwn
        onRetry={onRetry}
      />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByText('Не отправлено. Повторить'));

    expect(onRetry).toHaveBeenCalledWith('local-1');
  });

  it('plays a voice message in the bubble, for a visitor just as for a member', async () => {
    await render(
      <MessageBubble
        {...baseProps}
        message={textMessage({
          kind: 'voice',
          text: null,
          attachments: [
            {
              id: 'att-v',
              url: 'https://cdn.example/v.m4a',
              posterUrl: null,
              mimeType: 'audio/mp4',
              width: null,
              height: null,
              durationMs: 4200,
              waveform: [1, 2],
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByText('плеер https://cdn.example/v.m4a https://cdn.example/v.m4a'),
    ).toBeTruthy();
    expect(screen.queryByText('Вложение')).toBeNull();
  });

  it('keeps playing an own voice message from the local file after it is sent', async () => {
    await render(
      <MessageBubble
        {...baseProps}
        isOwn
        message={textMessage({
          kind: 'voice',
          text: null,
          authorId: 'user-1',
          localPreviews: ['file:///cache/v.m4a'],
          attachments: [
            {
              id: 'att-v',
              url: 'https://cdn.example/v.m4a',
              posterUrl: null,
              mimeType: 'audio/mp4',
              width: null,
              height: null,
              durationMs: 4200,
              waveform: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('плеер file:///cache/v.m4a file:///cache/v.m4a')).toBeTruthy();
  });

  describe('reactions', () => {
    const reactions = { members: { '👍': 2 }, visitors: { '🔥': 1 }, mine: null };

    it('keeps both rows inside the bubble of a text message', async () => {
      await render(<MessageBubble message={textMessage({ reactions })} {...baseProps} />);

      const bubble = screen.getByTestId('message-bubble');

      expect(within(bubble).getByTestId('member-reactions')).toBeTruthy();
      expect(within(bubble).getByTestId('visitor-reactions')).toBeTruthy();
    });

    it('puts the rows under my caption-less album, outside the bubble that has no background', async () => {
      await render(<MessageBubble message={mediaMessage({ reactions })} {...baseProps} isOwn />);

      expect(
        within(screen.getByTestId('message-bubble')).queryByTestId('message-reactions'),
      ).toBeNull();
      expect(screen.getByTestId('message-reactions')).toBeTruthy();
    });

    it('adds no room at all while there are no reactions', async () => {
      await render(<MessageBubble message={mediaMessage()} {...baseProps} isOwn />);

      expect(screen.queryByTestId('message-reactions')).toBeNull();
    });
  });
});
