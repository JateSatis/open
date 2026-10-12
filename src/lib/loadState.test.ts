import { QueryClient } from '@tanstack/react-query';

import { loadStateOf, reloadMissing } from '@/lib/loadState';

describe('loadStateOf', () => {
  it('данные есть — показываем их, даже если обновление упало', () => {
    expect(loadStateOf({ data: [], status: 'error', fetchStatus: 'idle' })).toBe('ready');
  });

  it('данных нет, попытки кончились — сбой', () => {
    expect(loadStateOf({ data: undefined, status: 'error', fetchStatus: 'idle' })).toBe('failed');
  });

  it('новая попытка после сбоя — снова загрузка', () => {
    expect(loadStateOf({ data: undefined, status: 'error', fetchStatus: 'fetching' })).toBe(
      'loading',
    );
  });

  it('устройство без сети — пауза, а не сбой', () => {
    expect(loadStateOf({ data: undefined, status: 'pending', fetchStatus: 'paused' })).toBe(
      'paused',
    );
  });
});

describe('reloadMissing', () => {
  it('сбрасывает только запросы без данных', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['chat', '1'], { id: '1' });
    const reset = jest.spyOn(queryClient, 'resetQueries');

    reloadMissing(queryClient, [
      ['chat', '1'],
      ['messages', '1'],
    ]);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith({ queryKey: ['messages', '1'], exact: true });
  });
});
