import { requestClient } from '@/api/requestClient';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useChangeGroupAvatar } from './useChangeGroupAvatar';

import { setChatAvatar } from '@/api/chats';
import { removeOwnGroupAvatar, removePublicMedia, uploadGroupAvatar } from '@/features/media';
import { DeadlineError } from '@/lib/deadline';

jest.mock('@/api/chats', () => ({ setChatAvatar: jest.fn() }));
jest.mock('@/features/media', () => ({
  uploadGroupAvatar: jest.fn(),
  removePublicMedia: jest.fn(),
  removeOwnGroupAvatar: jest.fn(),
}));

const mockedSet = setChatAvatar as jest.MockedFunction<typeof setChatAvatar>;
const mockedUpload = uploadGroupAvatar as jest.MockedFunction<typeof uploadGroupAvatar>;

const NEW = { url: 'https://x/media/me/group-avatar/new.jpg', path: 'me/group-avatar/new.jpg' };
const REPLACED = 'https://x/media/me/group-avatar/old.jpg';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function run(change: Parameters<ReturnType<typeof useChangeGroupAvatar>['mutateAsync']>[0]) {
  const { result } = await renderHook(() => useChangeGroupAvatar('group-1', 'me'), { wrapper });

  return act(() => result.current.mutateAsync(change));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUpload.mockResolvedValue(NEW);
  mockedSet.mockResolvedValue(REPLACED);
});

describe('useChangeGroupAvatar', () => {
  it('uploads into my prefix and removes the file the database actually replaced', async () => {
    await expect(run({ kind: 'set', uri: 'file:///g.jpg' })).resolves.toBe(NEW.url);

    expect(mockedUpload).toHaveBeenCalledWith('file:///g.jpg', 'me', requestClient());
    expect(mockedSet).toHaveBeenCalledWith('group-1', NEW.url, requestClient());
    expect(removeOwnGroupAvatar).toHaveBeenCalledWith(REPLACED, 'me', requestClient());
    expect(removePublicMedia).not.toHaveBeenCalled();
  });

  it('removing the photo deletes the replaced file, if it is mine', async () => {
    await expect(run({ kind: 'remove' })).resolves.toBeNull();

    expect(mockedSet).toHaveBeenCalledWith('group-1', null, requestClient());
    expect(removeOwnGroupAvatar).toHaveBeenCalledWith(REPLACED, 'me', requestClient());
  });

  it('a refused photo removes the fresh upload and keeps the old file', async () => {
    mockedSet.mockRejectedValue(new Error('Менять фото группы может только участник'));

    await expect(run({ kind: 'set', uri: 'file:///g.jpg' })).rejects.toThrow();

    expect(removePublicMedia).toHaveBeenCalledWith(NEW.path, requestClient());
    expect(removeOwnGroupAvatar).not.toHaveBeenCalled();
  });

  it('a request cut off by the deadline may have landed: the upload is kept', async () => {
    mockedSet.mockRejectedValue(new DeadlineError());

    await expect(run({ kind: 'set', uri: 'file:///g.jpg' })).rejects.toBeInstanceOf(DeadlineError);

    expect(removePublicMedia).not.toHaveBeenCalled();
    expect(removeOwnGroupAvatar).not.toHaveBeenCalled();
  });
});
