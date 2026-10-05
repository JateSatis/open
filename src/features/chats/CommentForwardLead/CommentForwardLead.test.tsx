import { fireEvent, render, screen } from '@testing-library/react-native';

import { CommentForwardLead } from './index';

import type { CommentForward } from '@/api/chats';
import { NO_REACTIONS } from '@/api/reactionCounts';

const forward: CommentForward = {
  commentId: 'c1',
  comment: {
    id: 'c1',
    messageId: 'm1',
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
});
