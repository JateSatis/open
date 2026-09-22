import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import { MessageBubble } from '.';

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

  it('renders a mosaic for a media message once its width is known, and opens the viewer on tap', async () => {
    await render(<MessageBubble message={mediaMessage()} {...baseProps} />);

    expect(screen.queryByText('Вложение')).toBeNull();

    // Тестовый рендерер не считает реальную раскладку — ширина облачка
    // приходит вручную тем же событием, что и на устройстве.
    fireEvent(screen.getByTestId('message-bubble'), 'layout', {
      nativeEvent: { layout: { width: 260, height: 40 } },
    });

    const image = await screen.findByLabelText('Открыть фото');
    const user = userEvent.setup();
    await user.press(image);

    expect(screen.getByText('Просмотр открыт')).toBeTruthy();
  });
});
