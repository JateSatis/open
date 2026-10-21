import { ContactRefusedError, describeContactRefusal, toContactError } from './contactErrors';

describe('contactErrors', () => {
  it('блокировка звучит как недоступность — заблокированному о ней не говорят', () => {
    expect(describeContactRefusal({ code: 'OPN08' })).toBe('Пользователь недоступен');
  });

  it('отказ базы превращается в понятную ошибку с кодом', () => {
    const error = toContactError({ code: 'OPN11', message: 'raw' });

    expect(error).toBeInstanceOf(ContactRefusedError);
    expect((error as ContactRefusedError).code).toBe('OPN11');
  });

  it('чужие ошибки не трогает', () => {
    const raw = { code: '42501', message: 'denied' };

    expect(toContactError(raw)).toBe(raw);
    expect(describeContactRefusal(raw)).toBeNull();
    expect(describeContactRefusal(null)).toBeNull();
  });
});
