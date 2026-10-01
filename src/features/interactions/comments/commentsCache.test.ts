import { mergeComments, removeComments, replaceComments, type CommentsPage } from './commentsCache';

import type { Comment } from '@/api/comments';
import { toCommentItem } from './commentItem';

function comment(id: string, minute: number, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    messageId: 'm1',
    chatId: 'chat-1',
    authorId: 'user-1',
    authorName: 'Марина',
    authorAvatarUrl: null,
    audience: 'visitor',
    kind: 'text',
    text: id,
    createdAt: `2026-09-30T10:0${minute}:00Z`,
    editedAt: null,
    attachments: [],
    reactions: { members: {}, visitors: {}, mine: null },
    replies: [],
    ...overrides,
  };
}

function page(...comments: Comment[]): CommentsPage {
  return { items: comments.map(toCommentItem), nextCursor: null };
}

const ids = (current: CommentsPage) => current.items.map((item) => item.id);

describe('comments cache', () => {
  it('merges new comments by time, newest first, without duplicates', () => {
    const merged = mergeComments(page(comment('c2', 2), comment('c1', 1)), [
      comment('c3', 3),
      comment('c2', 2),
    ]);

    expect(ids(merged)).toEqual(['c3', 'c2', 'c1']);
  });

  it('keeps the same object when nothing new came', () => {
    const current = page(comment('c1', 1));

    expect(mergeComments(current, [comment('c1', 1)])).toBe(current);
    expect(removeComments(current, new Set(['nope']))).toBe(current);
  });

  it('removes deleted comments', () => {
    expect(ids(removeComments(page(comment('c2', 2), comment('c1', 1)), new Set(['c1'])))).toEqual([
      'c2',
    ]);
  });

  it('replaces an edited comment in place and keeps local previews only when given', () => {
    const current = page(comment('c1', 1));
    const edited = comment('c1', 1, { text: 'правка', editedAt: '2026-09-30T11:00:00Z' });

    const replaced = replaceComments(current, [edited], new Map([['c1', ['file://a.jpg']]]));

    expect(replaced.items[0]).toEqual(
      expect.objectContaining({ text: 'правка', localPreviews: ['file://a.jpg'] }),
    );
  });
});
