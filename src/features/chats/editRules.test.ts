import {
  canRecordInEdit,
  editMediaRoom,
  editResultKind,
  isEditEmpty,
  isEditUnchanged,
} from './editRules';

import type { MessageAttachment } from '@/api/chats';
import type { ChatMessage, EditResult } from '@/features/chats/messages/types';
import type { MediaLibraryItem } from '@/features/media';

function attachment(id: string, mimeType = 'image/jpeg'): MessageAttachment {
  return {
    id,
    url: `https://cdn.example/${id}`,
    posterUrl: null,
    mimeType,
    width: 10,
    height: 10,
    durationMs: mimeType.startsWith('audio/') ? 1000 : null,
    waveform: null,
  };
}

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text',
    text: 'текст',
    createdAt: '2026-09-29T10:00:00Z',
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

const asset = { id: 'asset-1', kind: 'photo', width: 10, height: 10, durationMs: null } as
  MediaLibraryItem;

function result(overrides: Partial<EditResult>): EditResult {
  return { text: '', kept: [], added: [], voice: null, ...overrides };
}

describe('edit rules', () => {
  it('knows an edit with nothing in it is empty — whitespace is nothing', () => {
    expect(isEditEmpty(result({ text: '   ' }))).toBe(true);
    expect(isEditEmpty(result({ text: 'а' }))).toBe(false);
    expect(isEditEmpty(result({ kept: [attachment('p1')] }))).toBe(false);
    expect(isEditEmpty(result({ added: [asset] }))).toBe(false);
    expect(
      isEditEmpty(result({ voice: { type: 'kept', attachment: attachment('v', 'audio/mp4') } })),
    ).toBe(false);
  });

  it('derives the kind the way the database does', () => {
    expect(editResultKind(result({ text: 'а' }))).toBe('text');
    expect(editResultKind(result({ text: 'а', kept: [attachment('p1')] }))).toBe('media');
    expect(editResultKind(result({ added: [asset] }))).toBe('media');
    expect(
      editResultKind(result({ voice: { type: 'kept', attachment: attachment('v', 'audio/mp4') } })),
    ).toBe('voice');
  });

  it('sees no change in the same text, files and order', () => {
    const album = message({ kind: 'media', attachments: [attachment('p1'), attachment('p2')] });

    expect(isEditUnchanged(album, result({ text: ' текст ', kept: album.attachments }))).toBe(true);
    expect(isEditUnchanged(album, result({ text: 'текст', kept: [attachment('p2')] }))).toBe(false);
    expect(
      isEditUnchanged(album, result({ text: 'текст', kept: album.attachments, added: [asset] })),
    ).toBe(false);
    expect(isEditUnchanged(album, result({ text: 'другой', kept: album.attachments }))).toBe(false);
  });

  it('sees a new recording as a change, the same one as none', () => {
    const recording = attachment('v1', 'audio/mp4');
    const voice = message({ kind: 'voice', text: null, attachments: [recording] });

    expect(isEditUnchanged(voice, result({ voice: { type: 'kept', attachment: recording } }))).toBe(
      true,
    );
    expect(
      isEditUnchanged(
        voice,
        result({
          voice: {
            type: 'new',
            voice: {
              kind: 'voice',
              uri: 'file:///x.m4a',
              mimeType: 'audio/mp4',
              width: null,
              height: null,
              durationMs: 1000,
            },
          },
        }),
      ),
    ).toBe(false);
    expect(isEditUnchanged(voice, result({ text: 'расшифровка' }))).toBe(false);
  });

  it('lets a new recording in only into an empty edit', () => {
    expect(canRecordInEdit(result({}))).toBe(true);
    expect(canRecordInEdit(result({ text: 'а' }))).toBe(false);
    expect(canRecordInEdit(result({ kept: [attachment('p1')] }))).toBe(false);
  });

  it('counts how many files still fit into the album', () => {
    expect(editMediaRoom({ kept: [attachment('p1'), attachment('p2')], voice: null })).toBe(8);
    expect(editMediaRoom({ kept: [], voice: { type: 'kept', attachment: attachment('v') } })).toBe(
      0,
    );
    expect(
      editMediaRoom({
        kept: Array.from({ length: 10 }, (_, index) => attachment(`p${index}`)),
        voice: null,
      }),
    ).toBe(0);
  });
});
