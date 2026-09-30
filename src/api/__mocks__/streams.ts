// Ручной мок звонков для тестов экранов: по умолчанию звонка нет. Тест,
// которому нужен идущий звонок, подменяет `fetchLiveStream` сам.

export class StreamJoinError extends Error {
  constructor(
    readonly reason: 'ended' | 'not_found' | 'unauthorized' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

export const fetchLiveStream = jest.fn(() => Promise.resolve(null));
export const fetchStreamStatus = jest.fn(() => Promise.resolve(null));
export const listRingingStreams = jest.fn(() => Promise.resolve([]));
export const startCall = jest.fn(() => Promise.resolve({ streamId: 'stream-1', created: true }));
export const requestStreamToken = jest.fn();
export const syncStream = jest.fn(() => Promise.resolve());
export const listCallProfiles = jest.fn(() => Promise.resolve([]));
