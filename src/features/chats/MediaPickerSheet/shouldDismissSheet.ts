/** Скорость, с которой шит смахивают, а не тащат. */
export const FLING_VELOCITY = 800;

/**
 * Закрывать ли шит после того, как палец отпустили.
 *
 * Вынесено из worklet'а отдельной функцией, чтобы у порогов был настоящий
 * тест. В jest `react-native-reanimated` подменён моком, и shared value в нём
 * не хранит значений: `dismissY` там всегда остаётся тем, чем его
 * инициализировали, поэтому через жест проверить «отпустил, не дотянув» и
 * «тащил медленно» невозможно — любой жест выглядит как закрывающий. На
 * устройстве это видно глазами, а здесь — этими тремя случаями.
 *
 * @param dismissY  насколько шит утащен вниз от рабочего положения
 * @param threshold дистанция, за которой отпускание считается закрытием
 * @param velocityY скорость пальца в момент отпускания, вниз — положительная
 */
export function shouldDismissSheet(
  dismissY: number,
  threshold: number,
  velocityY: number,
): boolean {
  'worklet';

  return dismissY > threshold || velocityY > FLING_VELOCITY;
}
