import { AudioSession, registerGlobals } from '@livekit/react-native';

import { prepareLiveKit } from './livekitGlobals';

it('ошибка освобождает общую подготовку для следующей попытки', async () => {
  const register = jest.mocked(registerGlobals);
  register.mockImplementationOnce(() => {
    throw new Error('prepare failed');
  });
  const first = prepareLiveKit();
  expect(prepareLiveKit()).toBe(first);
  await expect(first).rejects.toThrow('prepare failed');

  const retry = prepareLiveKit();
  expect(retry).not.toBe(first);
  await retry;
  expect(prepareLiveKit()).toBe(retry);
  expect(register).toHaveBeenCalledTimes(2);
  expect(AudioSession.startAudioSession).not.toHaveBeenCalled();
});
