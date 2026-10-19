import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mixColors, useAvatarTint } from './avatarTint';
import { clamp01, infoGeometry, snapTarget, syncedOffset, titleProgress } from './geometry';
import { InfoBarButton } from './InfoBarButton';
import { InfoHero, photoRect } from './InfoHero';
import { InfoTabsBar } from './InfoTabsBar';
import { InfoTabList } from './InfoTabList';
import { InfoTitle } from './InfoTitle';
import { InfoScrollContext, type InfoScroll, type InfoTabListHandle } from './scroll';
import type {
  InfoAction,
  InfoAvatar,
  InfoPageHandle,
  InfoSearch,
  InfoStatus,
  InfoTab,
} from './types';
import type { SlideBack } from './useSlideBack';
import { InfoPhotoProgressContext } from './visual';

import { BarSearchField } from '@/components/BarSearchField';
import { SECTION_SETTLE_MS, SectionPager } from '@/features/channels/SectionPager';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageOpacity, InfoPageSizes, Spacing } from '@/theme';

export { InfoBarButton, InfoBarIcon } from './InfoBarButton';
export { InfoCard, InfoTextRow } from './InfoCard';
export { InfoLinkRow } from './InfoLinkRow';
export { InfoPersonRow } from './InfoPersonRow';
export { InfoTabList } from './InfoTabList';
export { useInfoTabsViewport } from './scroll';
export { useSlideBack, type SlideBack } from './useSlideBack';
export type {
  InfoAction,
  InfoAvatar,
  InfoPageHandle,
  InfoSearch,
  InfoStatus,
  InfoTab,
} from './types';

const S = InfoPageSizes;
const EMPTY: never[] = [];
const renderNothing = () => null;
/** За столько dp до прилипания под именем начинает проступать сводка вкладки. */
const STICK_FADE = 12;
/** Палец сдвинулся дальше — это уже не тап по аватарке, а протяжка. */
const TAP_SLOP = 10;

/** Страница без въезда-ухода: на месте, свайп вправо её не тянет. */
function useStillSlide(): Pick<SlideBack, 'offset' | 'makeSwipe'> {
  const offset = useSharedValue(0);
  const makeSwipe = useCallback(() => Gesture.Pan().enabled(false), []);

  return { offset, makeSwipe };
}

export type InfoPageProps = {
  /**
   * Въезд и уход страницы — из `useSlideBack` у владельца: ему тоже бывает
   * нужно уйти. Нет — страница стоит на месте как обычный экран (профиль).
   */
  slideBack?: SlideBack;
  /** «Назад» без въезда-ухода: экран стека. Нет ни его, ни `slideBack` — стрелки нет. */
  onBack?: () => void;
  title: string;
  status: InfoStatus | null;
  avatar: InfoAvatar;
  actions?: InfoAction[];
  /** Справа в панели: карандаш, «⋮» — кнопками `InfoBarButton` и `InfoBarIcon`. */
  barRight?: ReactNode;
  /** Карточки под шапкой: информация, «Подписаться». */
  cards?: ReactNode;
  tabs: InfoTab[];
  /** Тап по фото: полноэкранный просмотр. Нет — фото не нажимается. */
  onOpenPhoto?: () => void;
  /** Открытый поиск — поле на месте панели; `null` — панель как обычно. */
  search?: InfoSearch | null;
  /** Управление снаружи: перейти на вкладку. */
  ref?: Ref<InfoPageHandle>;
  testID?: string;
};

/**
 * Страница информации — чат, группа, канал, профиль: сверху фото во всю
 * ширину (нет фото — блок с буквой) с именем внизу слева; при прокрутке фото
 * уезжает вместе с содержимым и оставляет компактную плашку с именем;
 * карточки и вкладки с таблеткой и свайпом. Въезжает справа и уезжает за
 * пальцем, если владелец дал `slideBack`.
 *
 * Шапка и карточки лежат поверх списков вкладок и двигаются по смещению
 * активного списка (см. `geometry.ts`), поэтому листается нативный скролл, а
 * шапка следует за ним на UI-потоке.
 */
export function InfoPage({
  slideBack,
  onBack,
  title,
  status,
  avatar,
  actions = [],
  barRight,
  cards,
  tabs,
  onOpenPhoto,
  search = null,
  ref,
  testID,
}: InfoPageProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const still = useStillSlide();
  const { offset: slide, makeSwipe } = slideBack ?? still;
  const goBack = onBack ?? slideBack?.close;

  const photoUri = avatar.kind === 'single' ? avatar.uri : null;
  const tappable = Boolean(photoUri && onOpenPhoto);
  const geometry = useMemo(
    () => infoGeometry({ width, insetTop: insets.top, hasActions: actions.length > 0 }),
    [actions.length, insets.top, width],
  );
  const { heroHeight, barBottom, collapse } = geometry;

  const [cardsHeight, setCardsHeight] = useState<number | null>(cards ? null : 0);
  const [pageHeight, setPageHeight] = useState(windowHeight);
  const tabsTop = heroHeight + (cardsHeight ?? 0);
  // Без вкладок прилипать нечему: страница листается до конца карточек, но
  // хотя бы до того, как фото уйдёт под плашку.
  const stickY = tabs.length > 0 ? tabsTop - barBottom : Math.max(collapse, tabsTop - pageHeight);
  const listTop = tabs.length > 0 ? tabsTop + S.tabsHeight : tabsTop;

  const scrollY = useSharedValue(0);
  const activeTab = useSharedValue(0);
  const dragging = useSharedValue(false);
  const position = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const lastTab = Math.max(0, tabs.length - 1);

  // Вкладок стало меньше (удалили последнее голосовое) — не стоять за краем.
  const shownIndex = Math.min(index, lastTab);

  useEffect(() => {
    if (index <= lastTab) return;

    position.set(lastTab);
    activeTab.set(lastTab);
  }, [activeTab, index, lastTab, position]);
  // Списки вкладок по номеру. Не ref: их читают и обработчики жестов.
  const [handles] = useState(() => new Map<number, InfoTabListHandle>());

  // Тянуть страницу вправо можно с первой вкладки: дальше свайп вправо
  // листает вкладки назад.
  const canSwipeBack = useDerivedValue(() => position.value < 0.01);
  const swipeBack = useMemo(() => makeSwipe(canSwipeBack), [canSwipeBack, makeSwipe]);

  // Насколько панель ещё на фото: иконки на нём белые.
  const photoProgress = useDerivedValue(() => 1 - titleProgress(scrollY.value, geometry));
  const stuck = useDerivedValue(() => clamp01((scrollY.value - stickY + STICK_FADE) / STICK_FADE));

  const syncOthers = useCallback(
    (y: number) => {
      handles.forEach((handle, tab) => {
        if (tab === activeTab.value) return;

        const target = syncedOffset(y, handle.offset.value, stickY);

        if (Math.abs(target - handle.offset.value) > 0.5) handle.scrollTo(target, false);
      });
    },
    [activeTab, handles, stickY],
  );

  const scroll = useMemo<InfoScroll>(
    () => ({
      geometry,
      stickY,
      listTop,
      viewportHeight: pageHeight,
      scrollY,
      activeTab,
      dragging,
      register: (tab, handle) => {
        handles.set(tab, handle);

        return () => {
          if (handles.get(tab) === handle) handles.delete(tab);
        };
      },
      initialOffset: () => syncedOffset(scrollY.value, 0, stickY),
      onSettle: (tab, y) => {
        if (tab !== activeTab.value) return;

        const target = snapTarget(y, geometry);

        if (target !== null && Math.abs(target - y) > 0.5) {
          handles.get(tab)?.scrollTo(target, true);
        }

        syncOthers(target ?? y);
      },
      onDragStart: () => {},
    }),
    [activeTab, dragging, geometry, handles, listTop, pageHeight, scrollY, stickY, syncOthers],
  );

  const activate = useCallback(
    (next: number) => {
      activeTab.set(next);
      const handle = handles.get(next);

      if (handle) scrollY.set(handle.offset.value);
      setIndex(next);
    },
    [activeTab, handles, scrollY],
  );

  const selectTab = useCallback(
    (next: number) => {
      syncOthers(scrollY.value);
      position.set(withTiming(next, { duration: SECTION_SETTLE_MS }));
      activate(next);
    },
    [activate, position, scrollY, syncOthers],
  );

  const onPagerDragStart = useCallback(() => syncOthers(scrollY.value), [scrollY, syncOthers]);

  // Вкладки — новым массивом на каждый рендер владельца: хэндл читает их
  // отсюда, иначе он пересоздавался бы каждый раз.
  const tabsRef = useRef(tabs);

  useEffect(() => {
    tabsRef.current = tabs;
  });

  // Перейти на вкладку: шапка сворачивается до прилипания вкладок, а не
  // дальше, если её уже пролистали.
  useImperativeHandle(
    ref,
    () => ({
      focusTab: (tabKey: string) => {
        const at = tabsRef.current.findIndex((tab) => tab.key === tabKey);

        if (at === -1) return;

        if (at !== activeTab.value) selectTab(at);

        const handle = handles.get(at);

        handle?.scrollTo(Math.max(handle.offset.value, stickY), true);
      },
    }),
    [activeTab, handles, selectTab, stickY],
  );

  // Пока открыт поиск, шапка свёрнута: короткая выдача иначе скатила бы
  // список вверх, и под полем поиска снова развернулись бы фото и карточки.
  const searchValue = search?.value;

  useEffect(() => {
    if (searchValue === undefined) return;

    const frame = requestAnimationFrame(() => {
      const handle = handles.get(activeTab.value);

      if (handle && handle.offset.value < stickY) handle.scrollTo(stickY, false);
    });

    return () => cancelAnimationFrame(frame);
  }, [activeTab, handles, searchValue, stickY]);

  // Лупа вкладки — только на свёрнутой шапке: на развёрнутой ей нет места.
  const [isStuck, setIsStuck] = useState(false);

  useAnimatedReaction(
    () => stuck.value > 0.5,
    (now, before) => {
      if (now !== before) runOnJS(setIsStuck)(now);
    },
  );

  const openPhoto = useCallback(() => onOpenPhoto?.(), [onOpenPhoto]);
  const actionsTop = actions.length > 0 ? geometry.actionsTop : null;

  // Тап по фото ловит вся страница: само фото пропускает касания к списку,
  // чтобы за него можно было листать. Панель и кнопки на фото — не фото.
  const photoTap = useMemo(
    () =>
      Gesture.Tap()
        .enabled(tappable)
        .maxDistance(TAP_SLOP)
        .onEnd((event, success) => {
          if (!success || event.y < barBottom) return;

          const y = scrollY.value;
          const rect = photoRect(y, geometry);

          if (event.y > rect.y + rect.height || titleProgress(y, geometry) > 0.5) return;
          if (
            actionsTop !== null &&
            event.y >= actionsTop - y &&
            event.y <= actionsTop - y + S.actionHeight
          ) {
            return;
          }

          runOnJS(openPhoto)();
        }),
    [actionsTop, barBottom, geometry, openPhoto, scrollY, tappable],
  );
  const pageGesture = useMemo(
    () => Gesture.Simultaneous(swipeBack, photoTap),
    [photoTap, swipeBack],
  );

  // Цвет плашки: из фото, без фото — нейтральный цвет заглушки.
  const tint = useAvatarTint(photoUri);
  const neutralTop = mixColors(theme.background, theme.backgroundSelected, 1);
  const tintedTop = tint
    ? mixColors(theme.background, tint, InfoPageOpacity.tintStrength)
    : neutralTop;

  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: InfoPageOpacity.backdrop * (1 - clamp01(slide.value / width)),
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.min(scrollY.value, stickY) }],
  }));
  const barStyle = useAnimatedStyle(() => ({
    opacity: titleProgress(scrollY.value, geometry),
  }));

  const summary = tabs[shownIndex]?.summary ?? '';
  const searchTab = isStuck ? tabs[shownIndex]?.onSearch : undefined;
  const ready = cardsHeight !== null;

  return (
    <View style={StyleSheet.absoluteFill} testID={testID}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }, backdropStyle]}
      />
      <GestureDetector gesture={pageGesture}>
        <Animated.View
          style={[styles.page, { backgroundColor: theme.background }, pageStyle]}
          onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}
        >
          <InfoPhotoProgressContext.Provider value={photoProgress}>
            <InfoScrollContext.Provider value={scroll}>
              {/* Без вкладок список всё равно нужен: фото уводит и карточки
                  листает его прокрутка. */}
              {ready && tabs.length === 0 ? (
                <View style={StyleSheet.absoluteFill}>
                  <InfoTabList tab={0} data={EMPTY} renderItem={renderNothing} />
                </View>
              ) : null}
              {ready && tabs.length > 0 ? (
                <View style={StyleSheet.absoluteFill}>
                  <SectionPager
                    position={position}
                    width={width}
                    index={shownIndex}
                    onIndexChange={activate}
                    onDragStart={onPagerDragStart}
                    waitFor={swipeBack}
                    pages={tabs.map((tab, at) => (
                      <View key={tab.key} style={styles.fill}>
                        {tab.render(at)}
                      </View>
                    ))}
                  />
                </View>
              ) : null}

              <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="box-none">
                <View style={{ height: heroHeight }} pointerEvents="none" />
                {cards ? (
                  <View
                    testID="info-cards"
                    pointerEvents="box-none"
                    style={styles.cards}
                    onLayout={(event) => setCardsHeight(event.nativeEvent.layout.height)}
                  >
                    {cards}
                  </View>
                ) : null}
                {tabs.length > 0 ? (
                  <InfoTabsBar
                    tabs={tabs}
                    index={shownIndex}
                    position={position}
                    onSelect={selectTab}
                  />
                ) : null}
              </Animated.View>

              <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                <InfoHero geometry={geometry} scrollY={scrollY} avatar={avatar} actions={actions} />
              </View>

              <Animated.View
                pointerEvents="none"
                style={[
                  styles.barBackground,
                  { height: barBottom, backgroundColor: tintedTop },
                  barStyle,
                ]}
              />

              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <InfoTitle
                  geometry={geometry}
                  insetTop={insets.top}
                  scrollY={scrollY}
                  stuck={stuck}
                  title={title}
                  status={status}
                  summary={summary}
                  hasBack={Boolean(goBack)}
                />
              </View>

              {search ? (
                <View
                  style={[
                    styles.searchBar,
                    {
                      height: barBottom,
                      paddingTop: insets.top,
                      backgroundColor: theme.background,
                    },
                  ]}
                >
                  <BarSearchField
                    testID="info-search-input"
                    value={search.value}
                    onChangeText={search.onChangeText}
                    onClose={search.onClose}
                    placeholder={search.placeholder}
                  />
                </View>
              ) : (
                <View style={[styles.bar, { top: insets.top }]} pointerEvents="box-none">
                  {goBack ? (
                    <InfoBarButton
                      testID="info-back"
                      icon={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
                      accessibilityLabel="Назад"
                      onPress={goBack}
                    />
                  ) : null}
                  <View style={styles.barRight}>
                    {searchTab ? (
                      <InfoBarButton
                        testID="info-search"
                        icon={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                        accessibilityLabel="Поиск"
                        onPress={searchTab}
                      />
                    ) : null}
                    {barRight}
                  </View>
                </View>
              )}
            </InfoScrollContext.Provider>
          </InfoPhotoProgressContext.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
  /** Карточки не прилипают к краю фото. */
  cards: {
    paddingTop: Spacing.three,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  barBackground: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  bar: {
    position: 'absolute',
    left: Spacing.one,
    right: Spacing.one,
    height: S.barHeight,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
  },
  barRight: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.one,
  },
});
