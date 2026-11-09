import { render, screen, userEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MessageBubble } from '.';

import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import type { ChatMessage } from '@/features/chats/useChatMessages';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

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
    seq: Date.parse('2026-09-22T10:00:00Z'),
    createdAt: '2026-09-22T10:00:00Z',
    editedAt: null,
    edited: false,
    editMark: null,
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

type Node = ReturnType<typeof screen.getByTestId>;

/**
 * Какие из `ids` есть внутри `root` — в порядке дерева, то есть сверху вниз
 * по облачку: его части стоят столбцом.
 */
function stackOrder(root: Node, ids: string[]): string[] {
  const found: string[] = [];
  const walk = (node: Node) => {
    const id = node.props.testID as string | undefined;

    if (id && ids.includes(id) && !found.includes(id)) found.push(id);
    for (const child of node.children) {
      if (typeof child !== 'string') walk(child as Node);
    }
  };

  walk(root);

  return found;
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
  it('К2.5 сообщение заблокировавшего — заглушка без текста и реакций', async () => {
    await render(
      <MessageBubble
        {...baseProps}
        message={textMessage({ text: null, hidden: true })}
        comments={{ count: 3, onPress: jest.fn() }}
      />,
    );

    expect(screen.getByTestId('message-bubble-hidden')).toBeTruthy();
    expect(screen.getByText('Сообщение скрыто')).toBeTruthy();
    expect(screen.queryByTestId('comments-slot')).toBeNull();
  });

  it('без аватара у чужого облачка имя автора видно', async () => {
    await render(<MessageBubble {...baseProps} message={textMessage()} showAvatar={false} />);

    expect(screen.queryByLabelText('Профиль: Марина')).toBeNull();
    expect(screen.getByText('Марина')).toBeTruthy();
  });

  it('без имени автора у чужого облачка — ни имени, ни аватара; «из <чат>» остаётся', async () => {
    await render(
      <MessageBubble
        {...baseProps}
        message={textMessage()}
        showAvatar={false}
        showAuthor={false}
        sourceChat={{ name: 'Планы' }}
      />,
    );

    expect(screen.queryByText('Марина')).toBeNull();
    expect(screen.queryByLabelText('Профиль: Марина')).toBeNull();
    expect(screen.getByText('Планы')).toBeTruthy();
  });

  it('чужой альбом без имени и подписи — без облачка, как свой', async () => {
    await render(<MessageBubble {...baseProps} message={mediaMessage()} showAuthor={false} />);

    const bubble = screen.getByTestId('message-bubble');

    expect(StyleSheet.flatten(bubble.props.style).backgroundColor).toBe('transparent');
    expect(screen.queryByText('Марина')).toBeNull();
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

  it('время чата скрыто настройкой участника — ни часов, ни галочек, «ред.» остаётся', async () => {
    await render(
      <MessageBubble
        {...baseProps}
        isOwn
        message={textMessage({ authorId: 'me', createdAt: null, edited: true, editMark: 1 })}
      />,
    );

    expect(screen.queryByTestId('message-time')).toBeNull();
    expect(screen.queryByTestId('message-status-sent')).toBeNull();
    expect(screen.queryByTestId('message-status-read')).toBeNull();
    expect(screen.getByText('ред.')).toBeTruthy();
  });

  it('прочтение скрыто (взаимность) — время есть, галочек нет', async () => {
    await render(
      <MessageBubble
        {...baseProps}
        isOwn
        message={textMessage({ authorId: 'me', readsVisible: false })}
      />,
    );

    expect(screen.getByText('13:00')).toBeTruthy();
    expect(screen.queryByTestId('message-status-sent')).toBeNull();
    expect(screen.queryByTestId('message-status-read')).toBeNull();
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
      <MessageBubble
        {...baseProps}
        message={textMessage({ editedAt: '2026-09-22T10:05:00Z', edited: true, editMark: 1 })}
      />,
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

  it('К2.1 скрытое автором — плитка с подписью на месте файла, в просмотр не открывается', async () => {
    const shown = mediaMessage().attachments[0];

    await render(
      <MessageBubble
        message={mediaMessage({
          text: 'подпись видна',
          attachments: [
            { ...shown, id: 'att-hidden', url: '', hidden: true },
            { ...shown, id: 'att-2', url: 'user-2/photo/b.jpg' },
          ],
        })}
        {...baseProps}
      />,
    );

    expect(screen.getByLabelText('Фото скрыто автором')).toBeTruthy();
    expect(screen.getByText('подпись видна')).toBeTruthy();
    // Нажимается только открытое фото.
    expect(screen.getAllByLabelText('Открыть фото')).toHaveLength(1);

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Фото скрыто автором'));
    expect(screen.queryByText('Просмотр открыт')).toBeNull();

    await user.press(screen.getByLabelText('Открыть фото'));
    expect(screen.getByText('Просмотр открыт')).toBeTruthy();
  });

  it('К2.1 скрытое голосовое — длительность без волны и без плеера', async () => {
    await render(
      <MessageBubble
        message={textMessage({
          kind: 'voice',
          text: null,
          attachments: [
            {
              id: 'v1',
              url: '',
              posterUrl: null,
              mimeType: 'audio/mp4',
              width: null,
              height: null,
              durationMs: 7000,
              waveform: null,
              hidden: true,
            },
          ],
        })}
        {...baseProps}
      />,
    );

    expect(screen.getByLabelText('Голосовое скрыто автором, 0:07')).toBeTruthy();
    expect(screen.queryByText(/^плеер/)).toBeNull();
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

    // Сверху вниз: текст, крупные реакции, полоска статуса — а реакции
    // посетителей в ней, между временем и просмотрами.
    it('stacks text, member reactions and the status line last, visitors inside it', async () => {
      await render(<MessageBubble message={textMessage({ reactions })} {...baseProps} />);

      expect(
        stackOrder(screen.getByTestId('message-bubble'), ['member-reactions', 'bubble-footer-info']),
      ).toEqual(['member-reactions', 'bubble-footer-info']);
      const info = screen.getByTestId('bubble-footer-info');

      expect(within(info).queryByTestId('member-reactions')).toBeNull();
      expect(stackOrder(info, ['bubble-footer-meta', 'visitor-reactions'])).toEqual([
        'bubble-footer-meta',
        'visitor-reactions',
      ]);
    });

    it('with only visitor reactions puts them into the status line, with no row above', async () => {
      await render(
        <MessageBubble
          message={textMessage({ reactions: { ...reactions, members: {} } })}
          {...baseProps}
        />,
      );

      expect(screen.queryByTestId('bubble-footer-reactions')).toBeNull();
      expect(
        within(screen.getByTestId('bubble-footer-visitors')).getByTestId('visitor-reactions'),
      ).toBeTruthy();
    });

    it('my caption-less album grows a bubble of my colour; the status moves under the media', async () => {
      await render(<MessageBubble message={mediaMessage({ reactions })} {...baseProps} isOwn />);

      const bubble = screen.getByTestId('message-bubble');

      expect(StyleSheet.flatten(bubble.props.style).backgroundColor).not.toBe('transparent');
      expect(screen.queryByTestId('media-meta-overlay')).toBeNull();
      expect(stackOrder(bubble, ['member-reactions', 'bubble-footer-info'])).toEqual([
        'member-reactions',
        'bubble-footer-info',
      ]);
      expect(
        within(screen.getByTestId('bubble-footer-info')).getByTestId('visitor-reactions'),
      ).toBeTruthy();
    });

    it('a visitor reaction alone moves the status under the media too', async () => {
      await render(
        <MessageBubble
          message={mediaMessage({ reactions: { ...reactions, members: {} } })}
          {...baseProps}
        />,
      );

      expect(screen.queryByTestId('media-meta-overlay')).toBeNull();
      expect(screen.getByTestId('bubble-footer-info')).toBeTruthy();
    });

    it('my album has no bubble and keeps the status on the media while nothing is under it', async () => {
      await render(<MessageBubble message={mediaMessage()} {...baseProps} isOwn />);

      const bubble = screen.getByTestId('message-bubble');

      expect(StyleSheet.flatten(bubble.props.style).backgroundColor).toBe('transparent');
      expect(screen.getByTestId('media-meta-overlay')).toBeTruthy();
      expect(screen.queryByTestId('bubble-footer-info')).toBeNull();
      expect(screen.queryByTestId('member-reactions')).toBeNull();
    });

    it('a caption takes the status off the media and under the text', async () => {
      await render(<MessageBubble message={mediaMessage({ text: 'подпись' })} {...baseProps} />);

      expect(screen.queryByTestId('media-meta-overlay')).toBeNull();
      expect(screen.getByTestId('bubble-footer-info')).toBeTruthy();
    });

    describe('channel post (mergedCounts)', () => {
      const postReactions = {
        members: { '👍': 1, '🔥': 1 },
        visitors: { '🔥': 2, '😂': 1 },
        mine: null,
        reactors: {
          '👍': [
            { userId: 'owner', name: 'Владелец', avatarUrl: null, audience: 'member' as const },
          ],
        },
      };

      it('shows every reaction in one large row with summed counts and no visitors line', async () => {
        await render(
          <MessageBubble
            message={textMessage({ reactions: postReactions })}
            {...baseProps}
            reactionsLayout="mergedCounts"
          />,
        );

        expect(screen.queryByTestId('visitor-reactions')).toBeNull();
        // 🔥: 1 от владельца и 2 от зрителей.
        expect(screen.getByLabelText('🔥 3')).toBeTruthy();
        expect(screen.getByLabelText('😂 1')).toBeTruthy();
      });

      it('draws no avatars: a single reaction is bare, several show the number', async () => {
        await render(
          <MessageBubble
            message={textMessage({ reactions: postReactions })}
            {...baseProps}
            reactionsLayout="mergedCounts"
          />,
        );

        expect(screen.queryByTestId('reaction-people-👍')).toBeNull();
        expect(within(screen.getByTestId('reaction-chip-👍')).queryByText('1')).toBeNull();
        expect(within(screen.getByTestId('reaction-chip-🔥')).getByText('3')).toBeTruthy();
      });

      it('lets a visitor tap any reaction, members’ ones too', async () => {
        const onReactionToggle = jest.fn();
        const user = userEvent.setup();

        await render(
          <MessageBubble
            message={textMessage({ reactions: postReactions })}
            {...baseProps}
            reactionsLayout="mergedCounts"
            reactionAudience="visitor"
            onReactionToggle={onReactionToggle}
          />,
        );

        await user.press(screen.getByTestId('reaction-chip-👍'));

        expect(onReactionToggle).toHaveBeenCalledWith('👍');
      });
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
    expect(cover).toBeDisabled();
    // Обложка остаётся видимой без перехода в просмотр.
    expect(screen.queryByLabelText('Открыть видео')).toBeNull();
  });
});
