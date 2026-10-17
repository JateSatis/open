import { Easing } from 'react-native-reanimated';

/**
 * Темп перелёта медиа из плитки и обратно — один для просмотрщика и
 * предпросмотра шита медиа: они должны ощущаться одинаково.
 */
export const FLIGHT_MS = 280;
export const FLIGHT_EASING = Easing.out(Easing.cubic);
/** Уход за край экрана свайпом, когда плитки не видно. */
export const AWAY_MS = 200;
