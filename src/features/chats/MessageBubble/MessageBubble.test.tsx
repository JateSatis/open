import { render, screen, userEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

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
    viewsCount: 0,
    readAt: null,
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

  it('у своего отправленного — одна галочка, у прочитанного — две; время на месте', async () => {
    const { rerender } = await render(
      <MessageBubble {...baseProps} isOwn message={textMessage({ authorId: 'me' })} />,
    );

    expect(screen.getByTestId('message-status-sent')).toBeTruthy();
    expect(screen.queryByTestId('message-status-read')).toBeNull();
    expect(screen.getByText('13:00')).toBeTruthy();

    await rerender(
      <MessageBubble {...baseProps} isOwn isRead message={textMessage({ authorId: 'me' })} />,
    );

    expect(screen.getByTestId('message-status-read')).toBeTruthy();
    expect(screen.queryByTestId('message-status-sent')).toBeNull();
  });

  it('у чужого иконки статуса нет', async () => {
    await render(<MessageBubble {...baseProps} isRead message={textMessage()} />);

    expect(screen.queryByTestId(/^message-status-/)).toBeNull();
    expect(screen.queryByTestId('message-retry')).toBeNull();
  });

  it('у поста канала галочек нет, а лоадер и ошибка есть — хоть облачко и не «своё»', async () => {
    // Пост стоит у левого края и у владельца: облачко рисуется как чужое.
    const post = (overrides: Partial<ChatMessage>) => (
      <MessageBubble
        {...baseProps}
        receipts={false}
        message={textMessage({ authorId: 'me', ...overrides })}
      />
    );
    const { rerender } = await render(post({}));

    expect(screen.queryByTestId(/^message-status-/)).toBeNull();

    await rerender(post({ status: 'sending' }));

    expect(screen.getByTestId('message-status-sending')).toBeTruthy();

    await rerender(post({ status: 'failed', localId: 'local-1' }));

    expect(screen.getByLabelText('Не отправлено. Повторить')).toBeTruthy();
  });

  it('пока сообщение едет — время видно, рядом лоадер, просмотров нет', async () => {
    await render(
      <MessageBubble
        {...baseProps}
        isOwn
        message={textMessage({ authorId: 'me', status: 'sending', viewsCount: 3 })}
      />,
    );

    expect(screen.getByLabelText('Отправляется')).toBeTruthy();
    expect(screen.getByText('13:00')).toBeTruthy();
    expect(screen.queryByTestId('message-views')).toBeNull();
  });

  it('правка в пути — лоадер и «ред.» после него', async () => {
    await render(
      <MessageBubble
        {...baseProps}
        isOwn
        message={textMessage({ authorId: 'me', editStatus: 'saving', editedAt: null })}
      />,
    );

    expect(screen.getByText('ред.')).toBeTruthy();
    expect(screen.getByLabelText('Отправляется')).toBeTruthy();
  });

  it('у чужого исправленного — «ред.» сразу после времени', async () => {
    await render(
      <MessageBubble {...baseProps} message={textMessage({ editedAt: '2026-09-22T10:05:00Z' })} />,
    );

    const meta = within(screen.getByTestId('message-meta'))
      .getAllByText(/.+/)
      .map((node) => String(node.props.children));

    expect(meta).toEqual(['13:00', 'ред.']);
  });

  it('не отправленное — значок ошибки; в копии облачка он не нажимается', async () => {
    const onRetry = jest.fn();
    const message = textMessage({ authorId: 'me', status: 'failed', localId: 'local-1' });
    const { rerender } = await render(
      <MessageBubble {...baseProps} isOwn message={message} onRetry={onRetry} />,
    );
    const user = userEvent.setup();

    await user.press(screen.getByLabelText('Не отправлено. Повторить'));

    expect(onRetry).toHaveBeenCalledWith('local-1');

    await rerender(<MessageBubble {...baseProps} isOwn message={message} onRetry={undefined} />);

    expect(screen.getByTestId('message-retry')).toBeDisabled();
  });

  describe('круг комментариев', () => {
    it('стоит сбоку от облачка, а не внутри', async () => {
      await render(
        <MessageBubble {...baseProps} message={textMessage()} comments={{ count: 4 }} />,
      );

      expect(screen.getByTestId('comments-circle')).toBeTruthy();
      expect(
        within(screen.getByTestId('message-bubble')).queryByTestId('comments-circle'),
      ).toBeNull();
    });

    it('у чужого — справа от облачка, у своего — слева', async () => {
      const order = () =>
        screen
          .getAllByTestId(/^(message-bubble|comments-slot)$/)
          .map((node) => node.props.testID as string);
      const { rerender } = await render(
        <MessageBubble {...baseProps} message={textMessage()} comments={{ count: 1 }} />,
      );

      expect(order()).toEqual(['message-bubble', 'comments-slot']);

      await rerender(
        <MessageBubble {...baseProps} isOwn message={textMessage()} comments={{ count: 1 }} />,
      );

      expect(order()).toEqual(['comments-slot', 'message-bubble']);
    });

    it('место под круг держится и без круга — облачко не перестраивается', async () => {
      await render(<MessageBubble {...baseProps} message={textMessage()} commentsSlot />);

      expect(screen.getByTestId('comments-slot')).toBeTruthy();
      expect(screen.queryByTestId('comments-circle')).toBeNull();
    });

    it('у медиа без подписи — снаружи сбоку, поверх мозаики только время и просмотры', async () => {
      await render(
        <MessageBubble
          {...baseProps}
          message={mediaMessage({ viewsCount: 3 })}
          comments={{ count: 2 }}
        />,
      );

      const mosaic = screen.getByTestId('media-mosaic');

      expect(within(mosaic).getByTestId('message-meta')).toBeTruthy();
      expect(within(mosaic).getByTestId('message-views')).toBeTruthy();
      expect(within(mosaic).queryByTestId('comments-circle')).toBeNull();
      expect(screen.getByTestId('comments-circle')).toBeTruthy();
    });
  });

  it('отправленное, которое ещё никто не видел, — без счётчика просмотров', async () => {
    await render(<MessageBubble {...baseProps} message={textMessage({ viewsCount: 0 })} />);

    expect(screen.getByTestId('message-meta')).toBeTruthy();
    expect(screen.queryByTestId('message-views')).toBeNull();
  });

  it('просмотры — у отправленного с просмотрами; у комментария их нет', async () => {
    const { rerender } = await render(
      <MessageBubble {...baseProps} message={textMessage({ viewsCount: 15_400 })} />,
    );

    expect(screen.getByText('15K')).toBeTruthy();

    await rerender(
      <MessageBubble
        {...baseProps}
        showViews={false}
        message={textMessage({ viewsCount: 15_400 })}
      />,
    );

    expect(screen.queryByTestId('message-views')).toBeNull();
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
    await user.press(screen.getByLabelText('Не отправлено. Повторить'));

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

    it('puts member reactions in the bottom row and visitors on a line below it', async () => {
      await render(<MessageBubble message={textMessage({ reactions })} {...baseProps} />);

      const row = screen.getByTestId('bubble-footer-info');

      expect(within(row).getByTestId('member-reactions')).toBeTruthy();
      expect(within(row).queryByTestId('visitor-reactions')).toBeNull();
      expect(
        within(screen.getByTestId('message-bubble')).getByTestId('visitor-reactions'),
      ).toBeTruthy();
    });

    it('with only visitor reactions keeps the bottom row empty between time and views', async () => {
      await render(
        <MessageBubble
          message={textMessage({ reactions: { ...reactions, members: {} } })}
          {...baseProps}
        />,
      );

      expect(screen.queryByTestId('bubble-footer-reactions')).toBeNull();
      expect(screen.getByTestId('visitor-reactions')).toBeTruthy();
    });

    it('my caption-less album grows a bubble of my colour for its reactions', async () => {
      await render(<MessageBubble message={mediaMessage({ reactions })} {...baseProps} isOwn />);

      const bubble = screen.getByTestId('message-bubble');

      expect(within(bubble).getByTestId('member-reactions')).toBeTruthy();
      expect(within(bubble).getByTestId('visitor-reactions')).toBeTruthy();
      expect(StyleSheet.flatten(bubble.props.style).backgroundColor).not.toBe('transparent');
    });

    it('my album has no bubble and no room while there are no reactions', async () => {
      await render(<MessageBubble message={mediaMessage()} {...baseProps} isOwn />);

      const bubble = screen.getByTestId('message-bubble');

      expect(StyleSheet.flatten(bubble.props.style).backgroundColor).toBe('transparent');
      expect(screen.queryByTestId('member-reactions')).toBeNull();
      expect(screen.queryByTestId('visitor-reactions')).toBeNull();
    });

    it('a comment shows one shared row and no visitors line', async () => {
      await render(
        <MessageBubble
          message={textMessage({ reactions })}
          {...baseProps}
          reactionsLayout="merged"
        />,
      );

      expect(screen.getByTestId('reaction-chip-🔥')).toBeTruthy();
      expect(screen.queryByTestId('visitor-reactions')).toBeNull();
    });
  });

  it('draws a pop post as a vertical cover with «Pop» and its length, not a mosaic tile', async () => {
    const message = mediaMessage({
      text: 'привет',
      attachments: [
        {
          id: 'att-pop',
          url: 'https://cdn.example/pop.mp4',
          posterUrl: 'https://cdn.example/pop.jpg',
          mimeType: 'video/mp4',
          width: 720,
          height: 1280,
          durationMs: 6000,
          waveform: null,
          popId: 'pop-1',
        },
      ],
    });

    await render(<MessageBubble message={message} {...baseProps} wide />);

    const cover = screen.getByTestId('pop-post-cover');

    expect(within(cover).getByText('Pop')).toBeTruthy();
    expect(within(cover).getByText('0:06')).toBeTruthy();
    expect(screen.getByText('привет')).toBeTruthy();
    // Просмотр попа — следующий этап: обложка не кнопка «открыть видео».
    expect(screen.queryByLabelText('Открыть видео')).toBeNull();
  });
});
