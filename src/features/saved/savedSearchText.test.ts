import type { SavedMessage } from '@/api/saved';
import { savedSearchText } from '@/features/saved/savedSearchText';
import { normalizeSearch } from '@/features/search/searchText';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/media', () => ({}));

function saved(overrides: Partial<SavedMessage>): SavedMessage {
  return {
    id: 's',
    seq: 1,
    savedAt: '2026-10-20T10:00:00Z',
    sourceType: 'message',
    category: 'channel',
    sourceChatId: 'chat-c',
    sourceMessageId: 'm',
    sourceCommentId: null,
    sourceSeq: 1,
    commentMessageId: null,
    commentPopId: null,
    kind: 'media',
    text: null,
    authorId: null,
    authorName: null,
    authorAvatarUrl: null,
    authorOpaque: false,
    originalAt: null,
    watchLaterAt: null,
    watchDoneAt: null,
    pinnedAt: null,
    attachments: [],
    tagIds: [],
    edited: false,
    replies: [],
    ...overrides,
  };
}

describe('savedSearchText', () => {
  it('shows the text where the match is, without regard to case and ё', () => {
    expect(savedSearchText(saved({ text: 'Про Ёжика' }), normalizeSearch('ежик'))).toBe(
      'Про Ёжика',
    );
  });

  it('shows the pop title when the match is there', () => {
    const post = saved({ text: 'подпись', popTitle: 'Ёлка на празднике' });

    expect(savedSearchText(post, normalizeSearch('елк'))).toBe('Ёлка на празднике');
  });

  it('falls back to the text when neither contains the word as typed', () => {
    expect(savedSearchText(saved({ text: 'сообщения' }), normalizeSearch('сообщение'))).toBe(
      'сообщения',
    );
  });
});
