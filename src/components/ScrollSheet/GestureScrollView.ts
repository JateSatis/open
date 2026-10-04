import { ScrollView, type ScrollViewProps } from 'react-native';
import { createNativeWrapper } from 'react-native-gesture-handler';

/**
 * Скролл списка, про который жест закрытия шита знает, что с ним не спорит.
 *
 * `createNativeWrapper` вешает на `ScrollView` нативный жест RNGH и отдаёт
 * наружу сам `ScrollView` с проставленным `handlerTag` — одна и та же ссылка
 * годится и списку, и `simultaneousWithExternalGesture`.
 *
 * Не `GestureDetector` с `Gesture.Native()`: снаружи `FlashList` он цепляется
 * к вью-обёртке, а не к скроллу, и съедает скролл; вокруг самого `ScrollView`
 * он добавляет свою вью, и `FlashList` неверно считает положение содержимого.
 */
export const GestureScrollView = createNativeWrapper<ScrollViewProps>(ScrollView, {
  disallowInterruption: false,
  shouldCancelWhenOutside: false,
});
