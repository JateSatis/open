import { fireEvent, render, screen } from '@testing-library/react-native';

import { CommentForwardLead } from './index';

import type { CommentForward } from '@/api/chats';
import { NO_REACTIONS } from '@/api/reactionCounts';

const forward: CommentForward = {
  commentId: 'c1',
  comment: {
    id: 'c1',
    subject: { type: 'message', id: 'm1' },
    chatId: 'chat-src',
    threadRootId: null,
    authorId: 'user-2',
    authorName: 'Олег',
    authorAvatarUrl: null,
    kind: 'text',
    text: 'сам комментарий',
    createdAt: '2026-10-04T10:00:00Z',
    editedAt: null,
    attachments: [],
    reactions: NO_REACTIONS,
    target: {
      id: 'm1',
      createdAt: '2026-10-04T09:00:00Z',
      authorId: 'user-1',
      authorName: 'Марина',
      preview: {
        kind: 'text',
        text: 'исходное сообщение',
        thumbnailUrl: null,
        mediaCount: 0,
        firstMediaIsVideo: false,
        durationMs: null,
      },
    },
    pop: null,
    chat: { id: 'chat-src', name: 'Разговор', amMember: false },
  },
};

describe('CommentForwardLead', () => {
  it('says it is a comment, from which chat, under which message and by whom', async () => {
    await render(<CommentForwardLead forward={forward} isOwn={false} />);

    expect(screen.getByText('Комментарий из «Разговор»')).toBeTruthy();
    expect(screen.getByText('Марина')).toBeTruthy();
    expect(screen.getByText('исходное сообщение')).toBeTruthy();
    expect(screen.getByText('Олег')).toBeTruthy();
  });

  it('leads to the comment in its thread from the snippet and the chat, and to the author from the name', async () => {
    const openSource = jest.fn();
    const openAuthor = jest.fn();

    await render(
      <CommentForwardLead
        forward={forward}
        isOwn={false}
        onOpenSource={openSource}
        onOpenAuthor={openAuthor}
      />,
    );

    await fireEvent.press(screen.getByText('исходное сообщение'));
    await fireEvent.press(screen.getByText('Комментарий из «Разговор»'));
    await fireEvent.press(screen.getByLabelText('Профиль: Олег'));

    expect(openSource).toHaveBeenCalledTimes(2);
    expect(openAuthor).toHaveBeenCalledTimes(1);
  });

  it('is honest when the message under the comment is gone', async () => {
    await render(
      <CommentForwardLead
        forward={{ ...forward, comment: { ...forward.comment!, target: null } }}
        isOwn
      />,
    );

    expect(screen.getByText('Сообщение удалено')).toBeTruthy();
  });

  it('shows a stub when the comment itself was deleted', async () => {
    await render(<CommentForwardLead forward={{ commentId: 'c1', comment: null }} isOwn={false} />);

    expect(screen.getByText('Комментарий удалён')).toBeTruthy();
  });

  describe('comment to a pop', () => {
    const popForward: CommentForward = {
      commentId: 'c1',
      comment: {
        ...forward.comment!,
        subject: { type: 'pop', id: 'pop-1' },
        target: null,
        pop: { id: 'pop-1', channelId: 'ch-1', posterUrl: 'https://cdn.test/p.jpg', caption: null },
        chat: { id: 'posts-1', name: 'Pop Lab', amMember: false },
      },
    };

    it('quotes the pop with its vertical cover, under the channel’s name', async () => {
      await render(<CommentForwardLead forward={popForward} isOwn={false} />);

      expect(screen.getByText('Комментарий из «Pop Lab»')).toBeTruthy();
      expect(screen.getByText('🎬 Pop')).toBeTruthy();
      expect(screen.getByTestId('pop-quote-cover')).toBeTruthy();
      expect(screen.queryByTestId('reply-quote')).toBeNull();
      expect(screen.getByText('Олег')).toBeTruthy();
    });

    it('shows the first line of the caption instead of «Pop»', async () => {
      const captioned: CommentForward = {
        ...popForward,
        comment: {
          ...popForward.comment!,
          pop: { ...popForward.comment!.pop!, caption: '\nЗакат над морем\nвторая строка' },
        },
      };

      await render(<CommentForwardLead forward={captioned} isOwn={false} />);

      expect(screen.getByText('Закат над морем')).toBeTruthy();
    });

    it('opens the pop from the quote and the comment from the label', async () => {
      const openSource = jest.fn();
      const openPop = jest.fn();

      await render(
        <CommentForwardLead
          forward={popForward}
          isOwn={false}
          onOpenSource={openSource}
          onOpenPop={openPop}
        />,
      );

      await fireEvent.press(screen.getByTestId('pop-quote'));
      expect(openPop).toHaveBeenCalledTimes(1);
      expect(openSource).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByText('Комментарий из «Pop Lab»'));
      expect(openSource).toHaveBeenCalledTimes(1);
    });

    it('says the pop is gone and opens nothing from the quote', async () => {
      const openPop = jest.fn();

      await render(
        <CommentForwardLead
          forward={{ ...popForward, comment: { ...popForward.comment!, pop: null } }}
          isOwn={false}
          onOpenPop={openPop}
        />,
      );

      expect(screen.getByText('Поп удалён')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('pop-quote'));
      expect(openPop).not.toHaveBeenCalled();
      expect(screen.getByText('Олег')).toBeTruthy();
    });
  });
});
