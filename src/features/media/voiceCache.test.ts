import { File } from 'expo-file-system';

import { cachedVoiceUri, resolveVoiceUri } from './voiceCache';

type MockFakeFile = { uri: string; name: string; exists: boolean; size: number; move: jest.Mock };

const mockFiles = new Map<string, MockFakeFile>();

jest.mock('expo-file-system', () => {
  const makeFile = (...parts: unknown[]) => {
    const path = parts
      .map((part) => (typeof part === 'string' ? part : (part as { uri: string }).uri))
      .join('/');
    const existing = mockFiles.get(path);

    if (existing) return existing;

    const file: MockFakeFile = {
      uri: `file://${path}`,
      name: path.split('/').pop()!,
      exists: false,
      size: 0,
      move: jest.fn((target: MockFakeFile) => {
        target.exists = true;
        target.size = 100;
      }),
    };

    mockFiles.set(path, file);
    return file;
  };

  const FileMock = jest.fn().mockImplementation(makeFile) as unknown as jest.Mock & {
    downloadFileAsync: jest.Mock;
  };

  FileMock.downloadFileAsync = jest.fn(async (_url: string, destination: MockFakeFile) => destination);

  return {
    File: FileMock,
    Directory: jest.fn().mockImplementation(() => ({ uri: 'cache/voice', exists: true })),
    Paths: { cache: { uri: 'cache' } },
  };
});

const download = (File as unknown as { downloadFileAsync: jest.Mock }).downloadFileAsync;

beforeEach(() => {
  mockFiles.clear();
  download.mockClear();
});

describe('voiceCache', () => {
  it('uses a local recording as is', async () => {
    expect(await resolveVoiceUri('file:///recording.m4a')).toBe('file:///recording.m4a');
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads a voice message once and serves it from the cache after that', async () => {
    const url = 'https://cdn.test/media/u/voice/1.m4a';

    expect(cachedVoiceUri(url)).toBeNull();

    const first = await resolveVoiceUri(url);
    const second = await resolveVoiceUri(url);

    expect(first).toBe(second);
    expect(download).toHaveBeenCalledTimes(1);
    expect(cachedVoiceUri(url)).toBe(first);
  });

  it('shares one download between two quick taps', async () => {
    const url = 'https://cdn.test/media/u/voice/2.m4a';

    await Promise.all([resolveVoiceUri(url), resolveVoiceUri(url)]);

    expect(download).toHaveBeenCalledTimes(1);
  });
});
