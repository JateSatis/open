import { render, screen, userEvent, within } from '@testing-library/react-native';

import { MessageBubble } from '.';

import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import type { ChatMessage } from '@/features/chats/useChatMessages';

jest.mock('@/features/media', () => ({
  MediaViewer: ({ visible }: { visible: boolean }) => {
    const { Text } = require('react-native');
    return visible ? <Text>Просмотр открыт</Text> : null;
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
    attachments: [],
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
});
