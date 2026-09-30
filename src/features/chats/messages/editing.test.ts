import { QueryClient } from '@tanstack/react-query';

import { saveEdit } from './editing';
import { messagesQueryKey, type ChatHistory } from './historyCache';
import { resetPendingEdits, usePendingEdits } from './pendingEdits';

import { editMessage, type Message } from '@/api/chats';
import type { ChatMessage, EditResult } from '@/features/chats/messages/types';
import {
  reportDeviceNetwork,
  reportRealtimeJoined,
  resetConnectionState,
} from '@/features/connection/connectionStore';
import { removeUploadedMedia, uploadAllMedia, type MediaLibraryItem } from '@/features/media';
import { useInAppAlert } from '@/features/notifications/alertsStore';

jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
jest.mock('@/api/chats', () => ({ editMessage: jest.fn() }));
jest.mock('@/api/pins', () => ({}));
jest.mock('@/features/media', () => ({
  assetPreviewUri: (asset: { id: string }) => `preview:${asset.id}`,
  libraryAssetToLocalMedia: jest.fn((asset) => ({
    kind: 'photo',
    uri: asset.uri,
    mimeType: 'image/jpeg',
    width: 10,
    height: 10,
    durationMs: null,
  })),
  resolveLibraryAsset: jest.fn((asset) => Promise.resolve({ ...asset, uri: 'file:///a.jpg' })),
  uploadAllMedia: jest.fn(),
  removeUploadedMedia: jest.fn(() => Promise.resolve()),
  storedPaths: (item: { path: string }) => [item.path],
}));

const mockedEdit = editMessage as jest.MockedFunction<typeof editMessage>;
const mockedUpload = uploadAllMedia as jest.MockedFunction<typeof uploadAllMedia>;
const mockedRemove = removeUploadedMedia as jest.MockedFunction<typeof removeUploadedMedia>;

const kept = {
  id: 'p1',
  url: 'https://cdn.example/p1.jpg',
  posterUrl: null,
  mimeType: 'image/jpeg',
  width: 10,
  height: 10,
  durationMs: null,
  waveform: null,
};

const original: ChatMessage = {
  id: 'm1',
  chatId: 'chat-1',
  authorId: 'user-1',
  kind: 'media',
  text: 'было',
  createdAt: '2026-09-29T10:00:00Z',
  editedAt: null,
  attachments: [kept],
  replies: [],
  forward: null,
  reactions: { members: {}, visitors: {}, mine: null },
  status: 'sent',
};

const asset = { id: 'asset-2', kind: 'photo', width: 10, height: 10, durationMs: null } as
  MediaLibraryItem;

const uploaded = {
  kind: 'photo' as const,
  url: 'https://cdn.example/new.jpg',
  path: 'user-1/photo/new.jpg',
  posterUrl: null,
  posterPath: null,
  mimeType: 'image/jpeg',
  width: 10,
  height: 10,
  durationMs: null,
  sizeBytes: 100,
  waveform: null,
};

const result: EditResult = { text: 'стало', kept: [kept], added: [asset], voice: null };

const clients: QueryClient[] = [];

afterEach(() => {
  // Иначе таймеры сборки кеша держат Jest после последнего теста.
  clients.splice(0).forEach((client) => client.clear());
});

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });

  clients.push(queryClient);

  queryClient.setQueryData<ChatHistory>(messagesQueryKey('chat-1'), {
    items: [original],
    nextCursor: null,
  });

  return {
    queryClient,
    context: { queryClient, chatId: 'chat-1', currentUserId: 'user-1' },
    history: () => queryClient.getQueryData<ChatHistory>(messagesQueryKey('chat-1')),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPendingEdits();
  resetConnectionState();
  reportRealtimeJoined();
  useInAppAlert.setState({ alert: null });
  mockedUpload.mockResolvedValue([uploaded]);
});

describe('saveEdit', () => {
  it('shows the new version with local previews while the new file uploads', async () => {
    mockedUpload.mockReturnValue(new Promise(() => undefined));
    const { context } = setup();

    void saveEdit(context, original, result);

    const pending = usePendingEdits.getState().byChat['chat-1']?.m1;

    expect(pending).toMatchObject({
      text: 'стало',
      kind: 'media',
      editStatus: 'saving',
      localPreviews: ['', 'preview:asset-2'],
    });
    expect(pending?.attachments.map((attachment) => attachment.id)).toEqual(['p1', 'asset-2']);
    expect(pending?.editedAt).not.toBeNull();
  });

  it('keeps what stays by id, sends new files in full and settles the answer into history', async () => {
    const saved: Message = {
      ...original,
      text: 'стало',
      editedAt: '2026-09-29T11:00:00Z',
      attachments: [kept, { ...kept, id: 'p2', url: uploaded.url }],
    };

    mockedEdit.mockResolvedValue(saved);
    const { context, history } = setup();

    await saveEdit(context, original, result);

    expect(mockedEdit).toHaveBeenCalledWith('m1', {
      text: 'стало',
      media: [
        { attachmentId: 'p1' },
        {
          url: uploaded.url,
          posterUrl: null,
          mimeType: 'image/jpeg',
          width: 10,
          height: 10,
          durationMs: null,
          sizeBytes: 100,
        },
      ],
      voice: null,
    });
    expect(history()?.items[0]).toMatchObject({ text: 'стало', editedAt: '2026-09-29T11:00:00Z' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usePendingEdits.getState().byChat['chat-1']).toBeUndefined();
  });

  it('takes the new file back out of storage when the server refuses — the old ones stay', async () => {
    mockedEdit.mockRejectedValue({ code: '23514', message: 'check_violation' });
    const { context, history } = setup();

    await saveEdit(context, original, result);

    expect(mockedRemove).toHaveBeenCalledTimes(1);
    expect(mockedRemove).toHaveBeenCalledWith([uploaded.path]);
    expect(history()?.items[0]).toBe(original);
    expect(usePendingEdits.getState().byChat['chat-1']).toBeUndefined();
    expect(useInAppAlert.getState().alert).toMatchObject({
      text: 'Изменения не сохранены',
      action: { label: 'Повторить' },
    });
  });

  it('keeps uploaded files after a lost connection and offers the retry again once back online', async () => {
    mockedEdit.mockRejectedValue(new TypeError('Network request failed'));
    const { context } = setup();

    await saveEdit(context, original, result);

    expect(mockedRemove).not.toHaveBeenCalled();
    expect(useInAppAlert.getState().alert).toMatchObject({
      text: 'Изменения не сохранены: нет связи',
    });

    useInAppAlert.setState({ alert: null });
    reportDeviceNetwork(false);
    reportDeviceNetwork(true);
    reportRealtimeJoined();

    expect(useInAppAlert.getState().alert).toMatchObject({
      text: 'Связь вернулась, но изменения не сохранены',
      action: { label: 'Повторить' },
    });
  });
});
