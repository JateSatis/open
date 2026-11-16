import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import {
  useReanimatedKeyboardAnimation,
  useWindowDimensions as useKeyboardWindow,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Person } from '@/api/chats';
import { SEARCH_RATE_LIMIT_TEXT } from '@/api/searchLimits';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { AvatarPicker } from '@/features/chats/AvatarPicker';
import { PersonPickItem } from '@/features/chats/PersonPickItem';
import { useCreateChat } from '@/features/chats/useCreateChat';
import { usePeopleSearch } from '@/features/chats/usePeopleSearch';
import { useConnectionStatus } from '@/features/connection/useConnectionStatus';
import { useProfile } from '@/features/profile/queries';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

const GROUP_AVATAR_LABELS = { pick: 'Выбрать фото группы', change: 'Сменить фото группы' };

type Props = {
  initialUserId?: string;
  onOpenChat: (chatId: string) => void;
  onOpenRequest: (userId: string) => void;
};

/**
 * Выбор людей и создание чата. Один выбранный — личный диалог, несколько —
 * группа. Без запроса — друзья и люди из моих чатов; остальных находят
 * поиском, с учётом их настройки «Кто может найти меня в поиске»: каталога
 * всех пользователей нет. Люди, с которыми переписка уже есть, не прячутся:
 * новый чат с тем же человеком допустим, когда в прежнем все приняли заявки.
 * Другу диалог открывается сразу, не-другу — экран заявки.
 */
export function NewChatScreen({ initialUserId, onOpenChat, onOpenRequest }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  const { height: windowHeight } = useKeyboardWindow();
  const containerRef = useRef<View | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);
  const connection = useConnectionStatus();
  const [query, setQuery] = useState('');
  const people = usePeopleSearch(query);
  const peopleError = people.rateLimited
    ? SEARCH_RATE_LIMIT_TEXT
    : people.failed && connection === 'online'
      ? 'Не удалось загрузить людей'
      : null;
  // «Написать» из чужого профиля открывает этот экран с уже выбранным
  // человеком; дальше работают обычные правила создания чата.
  const [preselectedId] = useState(initialUserId);
  const [selected, setSelected] = useState<string[]>(() => (preselectedId ? [preselectedId] : []));
  const [title, setTitle] = useState('');
  // Фото не сбрасывается, когда выбор сузился до одного: снова двое — оно на месте.
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const isGroup = selected.length > 1;
  // Выбранные остаются в списке, даже когда их нет в выдаче: позвали из
  // чужого профиля (незнакомого без запроса не видно) или выбрали, а потом
  // сменили запрос. Невидимый выбранный ушёл бы в чат незаметно.
  const [picked, setPicked] = useState<ReadonlyMap<string, Person>>(new Map());
  const { data: preselectedProfile } = useProfile(preselectedId);
  const listed = useMemo(() => {
    const known = new Map(picked);

    if (preselectedProfile) {
      known.set(preselectedProfile.id, {
        id: preselectedProfile.id,
        displayName: preselectedProfile.displayName ?? 'Без имени',
        avatarUrl: preselectedProfile.avatarUrl,
        username: preselectedProfile.username,
      });
    }

    const shown = new Set(people.people.map((person) => person.id));
    const hiddenSelected = selected.flatMap((id) => {
      const person = known.get(id);

      return person && !shown.has(id) ? [person] : [];
    });

    return [...hiddenSelected, ...people.people];
  }, [people.people, picked, preselectedProfile, selected]);

  const { isCreating, problem, create, dismissProblem } = useCreateChat(onOpenChat, onOpenRequest);

  const toggle = useCallback(
    (personId: string) => {
      dismissProblem();
      const person = people.people.find((item) => item.id === personId);

      if (person) setPicked((current) => new Map(current).set(personId, person));
      setSelected((current) =>
        current.includes(personId)
          ? current.filter((id) => id !== personId)
          : [...current, personId],
      );
    },
    [dismissProblem, people.people],
  );

  /**
   * Что лежит под экраном до низа окна (обычно ничего: панели вкладок на
   * вложенных экранах нет). Клавиатура это перекрывает, поэтому низ
   * поднимается на её высоту за вычетом этого. Тот же приём, что в
   * переписке: KeyboardAvoidingView на Android с edge-to-edge кнопку не
   * поднимает.
   */
  const measureBottomOffset = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y, _width, height) =>
      setBottomOffset(Math.max(0, windowHeight - (y + height))),
    );
  }, [windowHeight]);

  const keyboardInsetStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(Math.abs(keyboard.height.value) - bottomOffset, 0),
  }));

  const createLabel =
    selected.length === 0
      ? 'Выберите, кого позвать'
      : selected.length === 1
        ? 'Позвать в диалог'
        : `Позвать в группу (${selected.length})`;

  return (
    <Animated.View
      ref={containerRef}
      onLayout={measureBottomOffset}
      style={[styles.flex, { backgroundColor: theme.background }, keyboardInsetStyle]}
    >
      <View style={styles.titleRow}>
        {/* Фото бывает только у группы: пока выбран один человек, круг притушен. */}
        <AvatarPicker
          owner="avatar:group-new"
          testID="group-avatar-picker"
          labels={GROUP_AVATAR_LABELS}
          uri={avatarUri}
          onChange={setAvatarUri}
          idle={!isGroup}
          disabled={isCreating}
          compact
        />
        <View style={styles.titleField}>
          <Input
            accessibilityLabel="Название чата"
            placeholder="Название — необязательно"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
        </View>
      </View>

      <View style={styles.search}>
        <Input
          testID="new-chat-search"
          accessibilityLabel="Поиск людей"
          placeholder="Поиск по имени или @username"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {people.isLoading ? (
        <ActivityIndicator accessibilityLabel="Загрузка пользователей" />
      ) : (
        <FlatList
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={listed}
          keyExtractor={(person) => person.id}
          keyboardShouldPersistTaps="handled"
          onEndReached={people.loadMore}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => (
            <PersonPickItem
              person={item}
              isSelected={selected.includes(item.id)}
              onToggle={toggle}
            />
          )}
          ListEmptyComponent={
            peopleError ? null : (
              <Text color="textSecondary">
                {query.trim()
                  ? 'Никого не нашлось'
                  : 'Здесь будут ваши друзья и люди из ваших чатов. Остальных найдите поиском.'}
              </Text>
            )
          }
        />
      )}

      <View
        style={[
          styles.footer,
          { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.two) },
        ]}
      >
        {peopleError ? <Text color="danger">{peopleError}</Text> : null}

        {problem?.kind === 'duplicate' ? (
          <View style={styles.duplicate}>
            <Text variant="small" color="textSecondary">
              Вы уже позвали этих людей, и ответили ещё не все. Новый чат с ними можно будет
              создать, когда все примут заявки.
            </Text>
            <Button
              label="Открыть тот чат"
              variant="secondary"
              onPress={() => onOpenChat(problem.chatId)}
            />
          </View>
        ) : null}

        {problem?.kind === 'failed' && problem.message ? (
          <Text variant="small" color="danger">
            {problem.message}
          </Text>
        ) : null}

        <Button
          label={createLabel}
          disabled={selected.length === 0}
          loading={isCreating}
          onPress={() => create({ inviteeIds: selected, title, avatarUri })}
        />

        <Text variant="caption" color="textSecondary">
          Чат публичный: прочитать его сможет кто угодно.
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  titleField: {
    flex: 1,
  },
  search: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.three,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  duplicate: {
    gap: Spacing.two,
  },
});
