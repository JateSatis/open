import { useQueryClient } from '@tanstack/react-query';
import { useRouteParams, useRouter } from '@/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import {
  useReanimatedKeyboardAnimation,
  useWindowDimensions as useKeyboardWindow,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { inviteToChat } from '@/api/groups';
import { SEARCH_RATE_LIMIT_TEXT } from '@/api/searchLimits';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import { usePeopleStatus } from '@/features/chats/ChatInfoPage/queries';
import { PersonPickItem } from '@/features/chats/PersonPickItem';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { usePeopleSearch } from '@/features/chats/usePeopleSearch';
import { useTheme } from '@/hooks/use-theme';
import { withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';
import { Spacing } from '@/theme';

/** Дольше приглашение не ждём — дальше это потеря связи. */
const INVITE_DEADLINE_MS = 20_000;

/**
 * «Добавить участников»: поиск людей и отметка нескольких. Позванный
 * получает заявку, как при создании группы, и участником становится, только
 * приняв её. Кто уже в группе или позван — помечен и не выбирается.
 */
export function ChatInviteScreen() {
  const { chatId } = useRouteParams<'ChatInvite'>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const keyboard = useReanimatedKeyboardAnimation();
  const { height: windowHeight } = useKeyboardWindow();
  const containerRef = useRef<View | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);
  const currentUserId = useCurrentUserId();
  const { chat } = useChat(chatId);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = usePeopleSearch(query);

  const members = useMemo(
    () => new Set((chat?.participants ?? []).map((person) => person.id)),
    [chat],
  );
  const invited = useMemo(() => new Set((chat?.waiting ?? []).map((person) => person.id)), [chat]);
  const ids = useMemo(() => candidates.people.map((person) => person.id), [candidates.people]);
  const statuses = usePeopleStatus(ids);

  const toggle = useCallback((personId: string) => {
    setError(null);
    setSelected((current) =>
      current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
    );
  }, []);

  const invite = useCallback(async () => {
    setError(null);
    setSending(true);

    try {
      await withDeadline(inviteToChat(chatId, selected), INVITE_DEADLINE_MS);
      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      router.back();
    } catch (failure) {
      setError(
        isNetworkError(failure)
          ? 'Нет связи. Проверьте интернет и попробуйте ещё раз.'
          : 'Не удалось пригласить. Попробуйте ещё раз.',
      );
    } finally {
      setSending(false);
    }
  }, [chatId, queryClient, router, selected]);

  // Клавиатура перекрывает то, что под экраном: низ поднимается на её высоту
  // без него (тот же приём, что в «Новом чате»).
  const measureBottomOffset = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y, _width, height) =>
      setBottomOffset(Math.max(0, windowHeight - (y + height))),
    );
  }, [windowHeight]);
  const keyboardInsetStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(Math.abs(keyboard.height.value) - bottomOffset, 0),
  }));

  return (
    <Animated.View
      ref={containerRef}
      onLayout={measureBottomOffset}
      style={[styles.flex, { backgroundColor: theme.background }, keyboardInsetStyle]}
    >
      <View style={styles.search}>
        <Input
          testID="invite-search"
          accessibilityLabel="Поиск людей"
          placeholder="Поиск людей…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {candidates.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator accessibilityLabel="Загрузка людей" />
        </View>
      ) : candidates.failed ? (
        <LoadFailed
          message={candidates.rateLimited ? SEARCH_RATE_LIMIT_TEXT : 'Не удалось загрузить людей'}
          onRetry={candidates.retry}
        />
      ) : (
        <FlatList
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          testID="invite-people"
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={candidates.people}
          keyExtractor={(person) => person.id}
          keyboardShouldPersistTaps="handled"
          extraData={{ selected, statuses }}
          onEndReached={candidates.loadMore}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <PersonPickItem
              person={item}
              isSelected={selected.includes(item.id)}
              onToggle={toggle}
              status={statuses.get(item.id) ?? null}
              unavailable={
                members.has(item.id) ? 'в группе' : invited.has(item.id) ? 'приглашён(а)' : null
              }
            />
          )}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text color="textSecondary">
                {query.trim() ? 'Никого не нашлось' : 'Позвать пока некого'}
              </Text>
            </View>
          }
        />
      )}

      <View
        style={[
          styles.footer,
          { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.two) },
        ]}
      >
        {error ? (
          <Text testID="invite-error" variant="small" color="danger">
            {error}
          </Text>
        ) : null}
        <Button
          testID="invite-submit"
          label={
            selected.length === 0 ? 'Выберите, кого позвать' : `Пригласить (${selected.length})`
          }
          disabled={selected.length === 0}
          loading={sending}
          onPress={() => void invite()}
        />
      </View>
    </Animated.View>
  );
}
