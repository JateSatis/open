import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useChatMessages } from './useChatMessages';

import { listMessages, sendMessage, sendVoiceMessage, subscribeToChat } from '@/api/chats';
import type { ChatChannelHandlers } from '@/api/chats';
import {
  reportRealtimeDown,
  reportRealtimeJoined,
  resetConnectionState,
} from '@/features/connection/connectionStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { removeUploadedMedia, uploadAllMedia } from '@/features/media';

// Только путь с медиа: остальное поведение (текст, повтор, догрузка после
// обрыва связи) уже проверено через экран чата в
// `src/app/(tabs)/chats/[chatId].test.tsx`, который использует этот хук как
// есть.
jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
jest.mock('@/api/chats', () => ({
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(),
  sendMessage: jest.fn(),
  sendVoiceMessage: jest.fn(),
  forwardMessages: jest.fn(),
  subscribeToChat: jest.fn(),
  deleteMessages: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  editMessage: jest.fn(),
  MESSAGE_PAGE_SIZE: 30,
}));
jest.mock('@/api/pins', () => ({
  listPinnedMessages: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/features/media', () => ({
  assetPreviewUri: jest.fn((asset) => asset.id),
  libraryAssetToLocalMedia: jest.fn((asset) => ({
    kind: asset.kind,
    uri: asset.uri,
    mimeType: 'image/jpeg',
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  })),
  // Путь к файлу может догоняться уже после выбора — к отправке он обязан
  // быть, поэтому мок просто отдаёт то, что уже есть.
  resolveLibraryAsset: jest.fn((asset) =>
    Promise.resolve({ ...asset, uri: 'file:///cache/a1.jpg' }),
  ),
  uploadAllMedia: jest.fn(),
  removeUploadedMedia: jest.fn(),
  storedPaths: (item: { path: string; posterPath: string | null }) =>
    item.posterPath ? [item.path, item.posterPath] : [item.path],
}));

const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSendMessage = sendMessage as jest.MockedFunction<typeof sendMessage>;
const mockedSendVoice = sendVoiceMessage as jest.MockedFunction<typeof sendVoiceMessage>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedUploadAll = uploadAllMedia as jest.MockedFunction<typeof uploadAllMedia>;
const mockedRemove = removeUploadedMedia as jest.MockedFunction<typeof removeUploadedMedia>;

// Файл из грида: путь к нему не известен, он добирается уже при отправке.
const asset = {
  id: 'content://media/external/images/media/1',
  kind: 'photo' as const,
  width: 800,
  height: 600,
  durationMs: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Исходящие живут вне экрана, в сторе, — между тестами их надо чистить.
  resetOutbox();
  mockedListMessages.mockResolvedValue({ items: [], nextCursor: null });
  mockedSubscribe.mockReturnValue({ broadcastTyping: jest.fn(), unsubscribe: jest.fn() });
});

describe('useChatMessages sending media', () => {
  it('shows the file locally right away, then swaps it for the uploaded attachment', async () => {
    mockedUploadAll.mockResolvedValue([
      {
        kind: 'photo',
        url: 'https://cdn.example/a1.jpg',
        path: 'user-1/photo/a1.jpg',
        posterUrl: null,
        posterPath: null,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        durationMs: null,
        sizeBytes: 1000,
        waveform: null,
      },
    ]);
    mockedSendMessage.mockResolvedValue({
      id: 'm1',
      chatId: 'chat-1',
      authorId: 'user-1',
      kind: 'media',
      text: null,
      createdAt: '2026-09-22T10:00:00Z',
      editedAt: null,
      attachments: [
        {
          id: 'att-1',
          url: 'https://cdn.example/a1.jpg',
          posterUrl: null,
          mimeType: 'image/jpeg',
          width: 800,
          height: 600,
          durationMs: null,
          waveform: null,
        },
      ],
      replies: [],
      forward: null,
      reactions: { members: {}, visitors: {}, mine: null },
      commentsCount: 0,
    });

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.send('', [asset]));

    await waitFor(() => expect(result.current.messages[0].status).toBe('sent'));
    // Локальный предпросмотр был по ссылке на файл на устройстве — после
    // ответа сервера он заменяется на реальное вложение целиком.
    expect(result.current.messages[0].attachments[0].url).toBe('https://cdn.example/a1.jpg');
    // Локальная картинка остаётся заглушкой, пока грузится удалённая.
    expect(result.current.messages[0].localPreviews).toEqual([asset.id]);
    expect(mockedSendMessage).toHaveBeenCalledWith('chat-1', {
      text: undefined,
      media: [
        {
          url: 'https://cdn.example/a1.jpg',
          posterUrl: null,
          mimeType: 'image/jpeg',
          width: 800,
          height: 600,
          durationMs: null,
          sizeBytes: 1000,
        },
      ],
    });
  });

  it('cleans up already-uploaded files when the message itself fails to send', async () => {
    mockedUploadAll.mockResolvedValue([
      {
        kind: 'photo',
        url: 'https://cdn.example/a1.jpg',
        path: 'user-1/photo/a1.jpg',
        posterUrl: null,
        posterPath: null,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        durationMs: null,
        sizeBytes: 1000,
        waveform: null,
      },
    ]);
    mockedSendMessage.mockRejectedValue(new Error('new row violates row-level security policy'));

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.send('подпись', [asset]));

    await waitFor(() => expect(result.current.messages[0].status).toBe('failed'));
    expect(mockedRemove).toHaveBeenCalledWith(['user-1/photo/a1.jpg']);
  });

  it('retries a failed media message from the original selection', async () => {
    mockedUploadAll.mockRejectedValueOnce(new Error('сеть пропала'));
    mockedUploadAll.mockResolvedValueOnce([
      {
        kind: 'photo',
        url: 'https://cdn.example/a1.jpg',
        path: 'user-1/photo/a1.jpg',
        posterUrl: null,
        posterPath: null,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        durationMs: null,
        sizeBytes: 1000,
        waveform: null,
      },
    ]);
    mockedSendMessage.mockResolvedValue({
      id: 'm1',
      chatId: 'chat-1',
      authorId: 'user-1',
      kind: 'media',
      text: null,
      createdAt: '2026-09-22T10:00:00Z',
      editedAt: null,
      attachments: [],
      replies: [],
      forward: null,
      reactions: { members: {}, visitors: {}, mine: null },
      commentsCount: 0,
    });

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.send('', [asset]));
    await waitFor(() => expect(result.current.messages[0].status).toBe('failed'));

    const localId = result.current.messages[0].localId!;

    await act(() => result.current.retry(localId));

    await waitFor(() => expect(result.current.messages[0].status).toBe('sent'));
    expect(mockedUploadAll).toHaveBeenCalledTimes(2);
  });

  it('does not deliver the same message twice when the connection flaps rapidly mid-retry', async () => {
    // Первая попытка проваливается — сообщение уходит в «failed» и
    // становится кандидатом на автоматический повтор при явлении связи.
    mockedSendMessage.mockRejectedValueOnce(new Error('сеть моргнула'));

    resetConnectionState();

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => reportRealtimeJoined());
    await act(() => result.current.send('привет'));
    await waitFor(() => expect(result.current.messages[0].status).toBe('failed'));

    // Повтор зависает намеренно — окно гонки должно закрыться раньше, чем
    // придёт ответ сервера, а не благодаря его скорости.
    let resolveRetry!: (value: Awaited<ReturnType<typeof sendMessage>>) => void;
    mockedSendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );

    // Связь мигает туда-сюда до того, как первый повтор успел завершиться —
    // без защиты каждое возвращение «в сеть» запустило бы ещё одну отправку
    // того же сообщения.
    await act(() => reportRealtimeDown());
    await act(() => reportRealtimeJoined());
    await act(() => reportRealtimeDown());
    await act(() => reportRealtimeJoined());

    resolveRetry({
      id: 'm2',
      chatId: 'chat-1',
      authorId: 'user-1',
      kind: 'text',
      text: 'привет',
      createdAt: '2026-09-16T10:05:00Z',
      editedAt: null,
      attachments: [],
      replies: [],
      forward: null,
      reactions: { members: {}, visitors: {}, mine: null },
      commentsCount: 0,
    });

    await waitFor(() => expect(result.current.messages[0].status).toBe('sent'));

    // Один провал плюс один повтор — не три параллельных попытки на одно и то же сообщение.
    expect(mockedSendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not duplicate a message that its own broadcast pulled in before the insert answered', async () => {
    let handlers: ChatChannelHandlers | null = null;
    mockedSubscribe.mockImplementation((_chatId, given) => {
      handlers = given;
      return { broadcastTyping: jest.fn(), unsubscribe: jest.fn() };
    });

    // Догрузка через listMessagesSince() требует уже известного "докуда
    // прочитано" — оно берётся из первой загрузки чата, поэтому в чате уже
    // есть одно более раннее сообщение.
    mockedListMessages.mockResolvedValue({
      items: [
        {
          id: 'm0',
          chatId: 'chat-1',
          authorId: 'user-2',
          kind: 'text' as const,
          text: 'до этого',
          createdAt: '2026-09-22T09:00:00Z',
          editedAt: null,
          attachments: [],
          replies: [],
          forward: null,
          reactions: { members: {}, visitors: {}, mine: null },
          commentsCount: 0,
        },
      ],
      nextCursor: null,
    });

    const saved = {
      id: 'm1',
      chatId: 'chat-1',
      authorId: 'user-1',
      kind: 'text' as const,
      text: 'привет',
      createdAt: '2026-09-22T10:00:00Z',
      editedAt: null,
      attachments: [],
      replies: [],
      forward: null,
      reactions: { members: {}, visitors: {}, mine: null },
      commentsCount: 0,
    };

    const { listMessagesSince } = jest.requireMock('@/api/chats') as {
      listMessagesSince: jest.Mock;
    };
    listMessagesSince.mockResolvedValue([saved]);

    // Вставка "висит" — как если бы свой же broadcast дошёл раньше, чем
    // ответ на INSERT успел вернуться клиенту.
    let resolveSend!: (value: Awaited<ReturnType<typeof sendMessage>>) => void;
    mockedSendMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.send('привет'));
    expect(result.current.messages).toHaveLength(2);

    // Свой broadcast прилетает первым и подтягивает то же сообщение под его
    // настоящим id — до того, как локальный placeholder успел смениться.
    await act(() => handlers?.onMessage());
    await waitFor(() => expect(result.current.messages).toHaveLength(3));

    await act(() => resolveSend(saved));

    // Placeholder убирается, а не переименовывается поверх уже пришедшей копии.
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.filter((message) => message.id === 'm1')).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('m1');
    expect(result.current.messages[0].status).toBe('sent');
  });
});

describe('useChatMessages large albums', () => {
  function assets(count: number) {
    return Array.from({ length: count }, (_, i) => ({ ...asset, id: `content://media/${i}` }));
  }

  it('splits more than ten files into messages of ten, caption on the first, all shown at once', async () => {
    // Отправка держится, пока тест смотрит на оптимистичные сообщения.
    mockedUploadAll.mockReturnValue(new Promise(() => undefined));

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.send('подпись', assets(23)));

    // Список новыми вперёд: последняя часть — первая в массиве.
    const parts = [...result.current.messages].reverse();

    expect(parts.map((m) => m.attachments.length)).toEqual([10, 10, 3]);
    expect(parts.map((m) => m.text)).toEqual(['подпись', null, null]);
    expect(parts.every((m) => m.status === 'sending')).toBe(true);
    // Порядок файлов — порядок выбора, сквозь все части.
    expect(parts.flatMap((m) => m.attachments.map((a) => a.id))).toEqual(
      assets(23).map((a) => a.id),
    );
  });

  it('keeps a part delivered through the broadcast below the parts still sending', async () => {
    let onMessage: () => void = () => undefined;

    mockedSubscribe.mockImplementation((_chatId, handlers) => {
      onMessage = handlers.onMessage;
      return { broadcastTyping: jest.fn(), unsubscribe: jest.fn() };
    });
    mockedUploadAll.mockReturnValue(new Promise(() => undefined));

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.send('', assets(13)));

    // Первая часть уже в базе, и broadcast о ней пришёл раньше ответа на вставку.
    mockedListMessages.mockResolvedValue({
      items: [
        {
          id: 'server-1',
          chatId: 'chat-1',
          authorId: 'user-1',
          kind: 'media',
          text: null,
          createdAt: '2026-09-26T10:00:00Z',
          editedAt: null,
          attachments: [],
          replies: [],
          forward: null,
          reactions: { members: {}, visitors: {}, mine: null },
          commentsCount: 0,
        },
      ],
      nextCursor: null,
    });
    await act(async () => onMessage());

    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    // Отправляющиеся части остаются сверху (самыми новыми).
    expect(result.current.messages.map((m) => m.status)).toEqual(['sending', 'sending', 'sent']);
  });
});

describe('useChatMessages voice messages', () => {
  const voice = {
    kind: 'voice' as const,
    uri: 'file:///cache/voice.m4a',
    mimeType: 'audio/mp4',
    width: null,
    height: null,
    durationMs: 4200,
    waveform: [0, 10, 31],
  };
  const uploadedVoice = {
    kind: 'voice' as const,
    url: 'https://cdn.example/voice.m4a',
    path: 'user-1/voice/v1.m4a',
    posterUrl: null,
    posterPath: null,
    mimeType: 'audio/mp4',
    width: null,
    height: null,
    durationMs: 4200,
    sizeBytes: 3000,
    waveform: [0, 10, 31],
  };
  const savedVoice = {
    id: 'm-voice',
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'voice' as const,
    text: null,
    createdAt: '2026-09-26T10:00:00Z',
    editedAt: null,
    attachments: [
      {
        id: 'att-voice',
        url: 'https://cdn.example/voice.m4a',
        posterUrl: null,
        mimeType: 'audio/mp4',
        width: null,
        height: null,
        durationMs: 4200,
        waveform: [0, 10, 31],
      },
    ],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
  };

  it('shows the voice bubble at once and sends exactly one voice message', async () => {
    let finishUpload: (value: (typeof uploadedVoice)[]) => void = () => undefined;
    mockedUploadAll.mockReturnValue(
      new Promise((resolve) => {
        finishUpload = resolve;
      }),
    );
    mockedSendVoice.mockResolvedValue(savedVoice);

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.sendVoice(voice));

    // До загрузки: облачко уже есть, играет локальный файл.
    expect(result.current.messages[0]).toMatchObject({
      kind: 'voice',
      status: 'sending',
      localPreviews: ['file:///cache/voice.m4a'],
    });
    expect(result.current.messages[0].attachments[0]).toMatchObject({
      url: 'file:///cache/voice.m4a',
      durationMs: 4200,
      waveform: [0, 10, 31],
    });

    await act(async () => finishUpload([uploadedVoice]));

    await waitFor(() => expect(result.current.messages[0].status).toBe('sent'));
    expect(mockedSendVoice).toHaveBeenCalledTimes(1);
    // Третий аргумент — цитаты ответа; это голосовое ни на что не отвечает.
    expect(mockedSendVoice).toHaveBeenCalledWith(
      'chat-1',
      {
        url: 'https://cdn.example/voice.m4a',
        mimeType: 'audio/mp4',
        durationMs: 4200,
        sizeBytes: 3000,
        waveform: [0, 10, 31],
      },
      [],
    );
    expect(mockedSendMessage).not.toHaveBeenCalled();
    // Своё голосовое и дальше играет из локального файла.
    expect(result.current.messages[0].localPreviews).toEqual(['file:///cache/voice.m4a']);
  });

  it('keeps a failed voice message for a retry and removes the orphaned upload', async () => {
    mockedUploadAll.mockResolvedValue([uploadedVoice]);
    mockedSendVoice.mockRejectedValueOnce(new Error('not a member')).mockResolvedValue(savedVoice);

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.sendVoice(voice));

    await waitFor(() => expect(result.current.messages[0].status).toBe('failed'));
    expect(mockedRemove).toHaveBeenCalledWith(['user-1/voice/v1.m4a']);

    await act(() => result.current.retry(result.current.messages[0].localId!));

    await waitFor(() => expect(result.current.messages[0].status).toBe('sent'));
    expect(mockedSendVoice).toHaveBeenCalledTimes(2);
  });

  it('shows «записывает голосовое» and clears it when their message arrives', async () => {
    let handlers: ChatChannelHandlers | undefined;
    mockedSubscribe.mockImplementation((_chatId, next) => {
      handlers = next;
      return { broadcastTyping: jest.fn(), unsubscribe: jest.fn() };
    });

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => handlers?.onTyping('user-2', 'recording_voice'));

    expect(result.current.activities).toEqual([{ userId: 'user-2', activity: 'recording_voice' }]);

    mockedListMessages.mockResolvedValue({
      items: [{ ...savedVoice, id: 'm-theirs', authorId: 'user-2' }],
      nextCursor: null,
    });
    await act(async () => handlers?.onMessage());

    await waitFor(() => expect(result.current.activities).toEqual([]));
  });

  it('announces recording right away even right after typing', async () => {
    const broadcastTyping = jest.fn();
    mockedSubscribe.mockReturnValue({ broadcastTyping, unsubscribe: jest.fn() });

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => result.current.notifyTyping());
    await act(async () => result.current.notifyRecordingVoice());
    await act(async () => result.current.notifyRecordingVoice());

    expect(broadcastTyping.mock.calls).toEqual([
      ['user-1', 'typing'],
      ['user-1', 'recording_voice'],
    ]);
  });
});

describe('useChatMessages removing own unsent messages', () => {
  const { deleteMessages: mockedDeleteMessages } = jest.requireMock('@/api/chats') as {
    deleteMessages: jest.Mock;
  };
  const saved = {
    id: 'm-saved',
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text' as const,
    text: 'передумал',
    createdAt: '2026-09-27T10:00:00Z',
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
  };

  it('drops a failed message locally without asking the server', async () => {
    mockedSendMessage.mockRejectedValue(new Error('not a member'));

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.send('передумал'));
    await waitFor(() => expect(result.current.messages[0].status).toBe('failed'));

    await act(() => result.current.discard(result.current.messages[0].localId!));

    expect(result.current.messages).toEqual([]);
    expect(mockedDeleteMessages).not.toHaveBeenCalled();
  });

  it('deletes on the server a message discarded while it was on its way', async () => {
    let answer: (message: typeof saved) => void = () => undefined;
    mockedSendMessage.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    mockedDeleteMessages.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.send('передумал'));
    await act(() => result.current.discard(result.current.messages[0].localId!));

    expect(result.current.messages).toEqual([]);

    await act(async () => answer(saved));

    // Сообщение уже в базе и разослано — убрать его можно только удалением для всех.
    await waitFor(() => expect(mockedDeleteMessages).toHaveBeenCalledWith(['m-saved']));
    expect(result.current.messages).toEqual([]);
  });
});

describe('useChatMessages replies and forwards', () => {
  const { forwardMessages: mockedForward } = jest.requireMock('@/api/chats') as {
    forwardMessages: jest.Mock;
  };

  const quote = {
    messageId: 'orig',
    state: 'live' as const,
    authorId: 'user-2',
    authorName: 'Марина',
    createdAt: '2026-09-29T09:00:00Z',
    editedAt: null,
    preview: {
      kind: 'text' as const,
      text: 'оригинал',
      thumbnailUrl: null,
      mediaCount: 0,
      firstMediaIsVideo: false,
      durationMs: null,
    },
  };

  function source(id: string, minute: number, overrides: Record<string, unknown> = {}) {
    return {
      id,
      chatId: 'chat-src',
      authorId: 'user-2',
      kind: 'text' as const,
      text: `текст ${id}`,
      createdAt: `2026-09-29T09:0${minute}:00Z`,
      editedAt: null,
      attachments: [],
      replies: [],
      forward: null,
      reactions: { members: {}, visitors: {}, mine: null },
      commentsCount: 0,
      status: 'sent' as const,
      ...overrides,
    };
  }

  function originOf(id: string, minute: number) {
    return {
      authorId: 'user-2',
      authorName: 'Марина',
      original: { messageId: id, chatId: 'chat-src', createdAt: `2026-09-29T09:0${minute}:00Z` },
    };
  }

  it('shows a reply at once with its quote and sends the quoted ids', async () => {
    let answer: (value: Awaited<ReturnType<typeof sendMessage>>) => void = () => undefined;
    mockedSendMessage.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.send('согласен', [], [quote]));

    expect(result.current.messages[0]).toMatchObject({
      text: 'согласен',
      status: 'sending',
      replies: [quote],
    });
    expect(mockedSendMessage).toHaveBeenCalledWith('chat-1', {
      text: 'согласен',
      media: undefined,
      replyTo: ['orig'],
    });

    await act(async () =>
      answer({
        id: 'm-reply',
        chatId: 'chat-1',
        authorId: 'user-1',
        kind: 'text',
        text: 'согласен',
        createdAt: '2026-09-29T10:00:00Z',
        editedAt: null,
        attachments: [],
        replies: [quote],
        forward: null,
        reactions: { members: {}, visitors: {}, mine: null },
        commentsCount: 0,
      }),
    );

    await waitFor(() => expect(result.current.messages[0].status).toBe('sent'));
  });

  it('sends the typed text first and the forwarded messages after it, in chat order', async () => {
    const calls: string[] = [];
    let openServer: () => void = () => undefined;
    const server = new Promise<void>((resolve) => (openServer = resolve));

    mockedSendMessage.mockImplementation(async (_chatId, input) => {
      await server;
      calls.push(`text:${input.text}`);
      return {
        id: 'm-text',
        chatId: 'chat-1',
        authorId: 'user-1',
        kind: 'text',
        text: input.text ?? null,
        createdAt: '2026-09-29T10:00:00Z',
        editedAt: null,
        attachments: [],
        replies: [],
        forward: null,
        reactions: { members: {}, visitors: {}, mine: null },
        commentsCount: 0,
      };
    });
    mockedForward.mockImplementation(async (_chatId: string, ids: string[]) => {
      calls.push(`forward:${ids.join(',')}`);
      return ids.map((id, index) => ({
        ...source(`copy-${id}`, 0),
        chatId: 'chat-1',
        authorId: 'user-1',
        text: `текст ${id}`,
        createdAt: `2026-09-29T10:00:0${index + 1}Z`,
        editedAt: null,
        forward: originOf(id, id === 'early' ? 1 : 5),
      }));
    });

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Отмечены вразнобой — уйти должны в порядке переписки.
    await act(() =>
      result.current.forward('смотри', [
        { message: source('late', 5), origin: originOf('late', 5) },
        { message: source('early', 1), origin: originOf('early', 1) },
      ]),
    );

    // Сразу: подпись снизу, над ней копии со строкой «Переслано от».
    const shown = [...result.current.messages].reverse();

    expect(shown.map((message) => message.text)).toEqual(['смотри', 'текст early', 'текст late']);
    expect(shown[1].forward).toEqual(originOf('early', 1));
    expect(shown.every((message) => message.status === 'sending')).toBe(true);

    await act(async () => openServer());

    await waitFor(() => expect(result.current.messages.every((m) => m.status === 'sent')).toBe(true));
    expect(calls).toEqual(['text:смотри', 'forward:early,late']);
  });

  it('forwards without text when the field is empty, as one call', async () => {
    mockedForward.mockRejectedValueOnce(new Error('сеть пропала'));
    mockedForward.mockImplementation(async (_chatId: string, ids: string[]) =>
      ids.map((id) => ({ ...source(`copy-${id}`, 0), chatId: 'chat-1', forward: originOf(id, 0) })),
    );

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() =>
      result.current.forward('  ', [
        { message: source('a', 1), origin: originOf('a', 1) },
        { message: source('b', 2), origin: originOf('b', 2) },
      ]),
    );

    await waitFor(() => expect(result.current.messages.map((m) => m.status)).toEqual(['failed', 'failed']));
    expect(mockedSendMessage).not.toHaveBeenCalled();

    // Повтор одного — повтор всей пересылки, одним вызовом.
    await act(() => result.current.retry(result.current.messages[0].localId!));

    await waitFor(() => expect(result.current.messages.map((m) => m.status)).toEqual(['sent', 'sent']));
    expect(mockedForward).toHaveBeenCalledTimes(2);
    expect(mockedForward).toHaveBeenLastCalledWith('chat-1', ['a', 'b']);
  });
});
