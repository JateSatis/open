import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useChatMessages } from './useChatMessages';

import { listMessages, sendMessage, subscribeToChat } from '@/api/chats';
import {
  reportRealtimeDown,
  reportRealtimeJoined,
  resetConnectionState,
} from '@/features/connection/connectionStore';
import { removeUploadedMedia, uploadAllMedia } from '@/features/media';

// Только путь с медиа: остальное поведение (текст, повтор, догрузка после
// обрыва связи) уже проверено через экран чата в
// `src/app/(tabs)/chats/[chatId].test.tsx`, который использует этот хук как
// есть.
jest.mock('@/api/chats', () => ({
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(),
  sendMessage: jest.fn(),
  subscribeToChat: jest.fn(),
}));
jest.mock('@/features/media', () => ({
  libraryAssetToLocalMedia: jest.fn((asset) => ({
    kind: asset.kind,
    uri: asset.uri,
    mimeType: 'image/jpeg',
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  })),
  uploadAllMedia: jest.fn(),
  removeUploadedMedia: jest.fn(),
}));

const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSendMessage = sendMessage as jest.MockedFunction<typeof sendMessage>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedUploadAll = uploadAllMedia as jest.MockedFunction<typeof uploadAllMedia>;
const mockedRemove = removeUploadedMedia as jest.MockedFunction<typeof removeUploadedMedia>;

const asset = {
  id: 'a1',
  kind: 'photo' as const,
  uri: 'file:///cache/a1.jpg',
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
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        durationMs: null,
        sizeBytes: 1000,
      },
    ]);
    mockedSendMessage.mockResolvedValue({
      id: 'm1',
      chatId: 'chat-1',
      authorId: 'user-1',
      kind: 'media',
      text: null,
      createdAt: '2026-09-22T10:00:00Z',
      attachments: [
        {
          id: 'att-1',
          url: 'https://cdn.example/a1.jpg',
          mimeType: 'image/jpeg',
          width: 800,
          height: 600,
          durationMs: null,
        },
      ],
    });

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.send('', [asset]));

    await waitFor(() => expect(result.current.messages[0].status).toBe('sent'));
    // Локальный предпросмотр был по ссылке на файл на устройстве — после
    // ответа сервера он заменяется на реальное вложение целиком.
    expect(result.current.messages[0].attachments[0].url).toBe('https://cdn.example/a1.jpg');
    expect(mockedSendMessage).toHaveBeenCalledWith('chat-1', {
      text: undefined,
      media: [
        {
          url: 'https://cdn.example/a1.jpg',
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
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        durationMs: null,
        sizeBytes: 1000,
      },
    ]);
    mockedSendMessage.mockRejectedValue(new Error('new row violates row-level security policy'));

    const { result } = await renderHook(() => useChatMessages('chat-1', 'user-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.send('подпись', [asset]));

    await waitFor(() => expect(result.current.messages[0].status).toBe('failed'));
    expect(mockedRemove).toHaveBeenCalledWith('user-1/photo/a1.jpg');
  });

  it('retries a failed media message from the original selection', async () => {
    mockedUploadAll.mockRejectedValueOnce(new Error('сеть пропала'));
    mockedUploadAll.mockResolvedValueOnce([
      {
        kind: 'photo',
        url: 'https://cdn.example/a1.jpg',
        path: 'user-1/photo/a1.jpg',
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        durationMs: null,
        sizeBytes: 1000,
      },
    ]);
    mockedSendMessage.mockResolvedValue({
      id: 'm1',
      chatId: 'chat-1',
      authorId: 'user-1',
      kind: 'media',
      text: null,
      createdAt: '2026-09-22T10:00:00Z',
      attachments: [],
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
      () => new Promise((resolve) => { resolveRetry = resolve; }),
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
      attachments: [],
    });

    await waitFor(() => expect(result.current.messages[0].status).toBe('sent'));

    // Один провал плюс один повтор — не три параллельных попытки на одно и то же сообщение.
    expect(mockedSendMessage).toHaveBeenCalledTimes(2);
  });
});
