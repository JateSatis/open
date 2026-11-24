import { requestSelection } from '@/api/screenRequest';
import {
  CommonActions,
  StackActions,
  createNavigationContainerRef,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useLayoutEffect, useMemo } from 'react';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { create } from 'zustand';

import { journalScreen } from './journalScreen';
import { enterScreen } from '@/features/recs/journal/appSession';
import type { Destination, RootParams } from './types';

export { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
export type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export const navigationRef = createNavigationContainerRef<RootParams>();
export const useCurrentScreen = create<{ name: string; screen: string; tab: string | null }>(
  () => ({ name: '', screen: '', tab: null }),
);

export function trackScreen() {
  const route = navigationRef.getCurrentRoute();
  const name = route?.name ?? '';
  const tabs = navigationRef.getRootState()?.routes.find((r) => r.name === 'Tabs')?.state;
  const tab = tabs?.routes[tabs.index ?? 0]?.name;
  const current = journalScreen(
    name,
    tab === 'feed' || tab === 'profile' || tab === 'chats' ? tab : null,
    route?.params,
  );
  useCurrentScreen.setState({ name, ...current });
  if (route) enterScreen(current.screen, current.tab);
}

function open(destination: Destination, action: 'push' | 'replace' | 'navigate') {
  if (!navigationRef.isReady()) return;
  const state = navigationRef.getRootState();
  if (!state?.routeNames.includes(destination.name)) return;
  const { name, params } = destination;
  if (name === 'Tabs') {
    // One persistent tab navigator under all details; preserve its inactive screens.
    navigationRef.dispatch(StackActions.popTo('Tabs', params));
  } else {
    navigationRef.dispatch(
      action === 'navigate'
        ? CommonActions.navigate(name, params)
        : action === 'push'
          ? StackActions.push(name, params)
          : StackActions.replace(name, params),
    );
  }
}

export const router = {
  push: (to: Destination) => open(to, 'push'),
  replace: (to: Destination) => open(to, 'replace'),
  navigate: (to: Destination) => open(to, 'navigate'),
  back: () => navigationRef.goBack(),
  canGoBack: () => navigationRef.canGoBack(),
};

export function useRouter() {
  return useMemo(() => {
    const selected = requestSelection();
    const active = () => selected === requestSelection();
    return {
      push: (to: Destination) => { if (active()) router.push(to); },
      replace: (to: Destination) => { if (active()) router.replace(to); },
      navigate: (to: Destination) => { if (active()) router.navigate(to); },
      back: () => { if (active()) router.back(); },
      canGoBack: () => active() && router.canGoBack(),
    };
  }, []);
}

export function useRouteParams<N extends keyof RootParams>() {
  return (useRoute<RouteProp<RootParams, N>>().params ?? {}) as NonNullable<RootParams[N]>;
}

export function ScreenOptions({ options }: { options: NativeStackNavigationOptions }) {
  const navigation = useNavigation();
  useLayoutEffect(() => navigation.setOptions(options), [navigation, options]);
  return null;
}

export function Redirect({ href }: { href: Destination }) {
  const navigation = useNavigation();
  const { key } = useRoute();
  useLayoutEffect(() => {
    // Address the route that resolved, even if another detail is now on top.
    navigation.dispatch({
      ...StackActions.replace(href.name, href.params),
      target: navigation.getState()?.key,
      source: key,
    });
  }, [navigation, key, href]);
  return null;
}
