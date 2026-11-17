import { useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from '@/navigation';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallControl } from './CallControl';
import { SpeakerTile } from './SpeakerTile';
import { styles } from './styles';

import { listCallPeople } from '@/api/streams';
import { Text } from '@/components/Text';
import { leaveCall, toggleMic, toggleSpeaker } from '@/features/streams/callSession';
import { speakerOrder, useActiveCall } from '@/features/streams/callStore';
import { formatCallTimer, listenersLabel, onAirLabel } from '@/features/streams/callText';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

/** Как часто переспрашивать людей звонка, пока кого-то нет в ответе базы. */
const PEOPLE_RETRY_MS = 2_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  return now;
}

/**
 * Экран звонка. Звонок ему не принадлежит — он живёт в `callSession`, и уход
 * с экрана его сворачивает, а не обрывает. Публичность видна всегда: у
 * говорящего крупная отметка «В эфире · слушают N», у слушателя — «Вы слушаете».
 */
export function CallScreen() {
  const call = useActiveCall();
  const router = useRouter();
  const focused = useIsFocused();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const hadCall = useRef(false);

  const streamId = call?.streamId;
  const speakerIds = useMemo(
    () => (call?.speakers ?? []).map((speaker) => speaker.id).sort(),
    [call?.speakers],
  );
  // В комнате LiveKit нет ни id людей, ни имён — только identity звонка.
  // Кто за ней стоит, говорит база, глазами смотрящего.
  const { data: people } = useQuery({
    queryKey: ['streams', 'people', streamId, speakerIds],
    queryFn: () => listCallPeople(streamId as string),
    enabled: Boolean(streamId) && speakerIds.length > 0,
    staleTime: 60_000,
    // Вошедшего комната показывает раньше, чем вебхук LiveKit запишет его в
    // базу: пока кого-то нет в ответе, переспрашиваем.
    refetchInterval: (query) => {
      const known = new Set((query.state.data ?? []).map((person) => person.identity));

      return speakerIds.some((id) => !known.has(id)) ? PEOPLE_RETRY_MS : false;
    },
  });
  const speakers = useMemo(() => {
    const byIdentity = new Map((people ?? []).map((person) => [person.identity, person]));

    return (call?.speakers ?? [])
      .map((speaker) => {
        const person = byIdentity.get(speaker.id);

        return {
          speaker: person ? { ...speaker, name: person.displayName } : speaker,
          avatarUrl: person?.avatarUrl ?? null,
        };
      })
      .sort((a, b) => speakerOrder(a.speaker, b.speaker));
  }, [call?.speakers, people]);

  // Звонок кончился, пока экран открыт (вышли все, связь не вернулась), —
  // экран закрывается сам; почему — скажет карточка из `callSession`.
  useEffect(() => {
    if (call) {
      hadCall.current = true;
      return;
    }

    if (focused && hadCall.current && router.canGoBack()) router.back();
  }, [call, focused, router]);

  const minimize = () => {
    if (router.canGoBack()) router.back();
  };

  // Экран закроет эффект выше, как только звонка не станет: второй «назад»
  // отсюда увёл бы ещё и с экрана чата.
  const leave = () => {
    void leaveCall();
  };

  if (!call) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: theme.callBackground }]}>
        <ActivityIndicator color={theme.textOnMedia} />
      </View>
    );
  }

  const speaks = call.role !== 'listener';
  const state =
    call.connection === 'connecting'
      ? 'Подключение…'
      : call.connection === 'reconnecting'
        ? 'Переподключение…'
        : formatCallTimer(now - call.joinedAt);

  return (
    <View
      testID="call-screen"
      style={[
        styles.screen,
        {
          backgroundColor: theme.callBackground,
          paddingTop: insets.top + Spacing.two,
          paddingBottom: insets.bottom + Spacing.four,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Свернуть звонок"
          hitSlop={Spacing.three}
          onPress={minimize}
        >
          <SymbolView
            name={{
              ios: 'chevron.down',
              android: 'keyboard_arrow_down',
              web: 'keyboard_arrow_down',
            }}
            size={Sizes.callControlIcon}
            tintColor={theme.textOnMedia}
          />
        </Pressable>

        <View style={styles.headerTitle}>
          <Text variant="bodyBold" color="textOnMedia" numberOfLines={1}>
            {call.chatTitle}
          </Text>
          <Text
            testID="call-state"
            variant="small"
            style={{
              color: call.connection === 'reconnecting' ? theme.onAir : theme.textOnCallSecondary,
            }}
          >
            {state}
          </Text>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      <View
        testID="on-air"
        style={[
          styles.onAir,
          speaks
            ? { backgroundColor: theme.onAir }
            : { borderColor: theme.textOnCallSecondary, borderWidth: 1 },
        ]}
      >
        {speaks ? <View style={[styles.dot, { backgroundColor: theme.textOnMedia }]} /> : null}
        <Text variant="bodyBold" color="textOnMedia">
          {speaks ? onAirLabel(call.listeners) : `Вы слушаете · ${listenersLabel(call.listeners)}`}
        </Text>
      </View>

      {speaks ? (
        <Text variant="small" style={[styles.onAirHint, { color: theme.textOnCallSecondary }]}>
          Звонок публичный: слушать его может кто угодно
        </Text>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.grid}
      >
        {speakers.map(({ speaker, avatarUrl }) => (
          <SpeakerTile key={speaker.id} speaker={speaker} avatarUrl={avatarUrl} />
        ))}
      </ScrollView>

      <View style={styles.controls}>
        {speaks ? (
          <CallControl
            testID="call-mic"
            label={call.micOn ? 'Микрофон' : 'Микрофон выкл.'}
            icon={
              call.micOn
                ? { ios: 'mic.fill', android: 'mic', web: 'mic' }
                : { ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' }
            }
            active={!call.micOn}
            onPress={() => void toggleMic()}
          />
        ) : null}
        <CallControl
          testID="call-speaker"
          label="Динамик"
          icon={{ ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }}
          active={call.speakerOn}
          onPress={() => void toggleSpeaker()}
        />
        <CallControl
          testID="call-leave"
          label="Выйти"
          icon={{ ios: 'phone.down.fill', android: 'call_end', web: 'call_end' }}
          tone="danger"
          onPress={leave}
        />
      </View>
    </View>
  );
}
