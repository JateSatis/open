import AsyncStorage from '@react-native-async-storage/async-storage';

// Отметка «у этого аккаунта дата рождения уже есть». Дату нельзя стереть,
// только сменить, поэтому отметка не устаревает. Нужна, чтобы холодный старт
// без сети или на медленной сети не ждал ответа сервера перед «Чатами»:
// источник правды по-прежнему сервер, отметка лишь позволяет не ждать его.

const keyOf = (userId: string) => `privacy.birthDateKnown.${userId}`;

export async function isBirthDateKnown(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(keyOf(userId))) === '1';
  } catch {
    return false;
  }
}

export async function rememberBirthDateKnown(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyOf(userId), '1');
  } catch {
    // Не запомнили — в следующий раз подождём сервер, только и всего.
  }
}
