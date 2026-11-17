import { createNativeStackNavigator } from '@react-navigation/native-stack';

import type { RootParams } from '@/navigation/types';

export const Stack = createNativeStackNavigator<RootParams>();
export const hidden = { headerShown: false };
