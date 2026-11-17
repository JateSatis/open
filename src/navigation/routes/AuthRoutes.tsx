import { SignInScreen } from '@/features/auth/SignInScreen';
import { BirthDateScreen } from '@/features/privacy/BirthDateScreen';
import { hidden, Stack } from './rootStack';

export const authRoutes = {
  SignIn: <Stack.Screen name="SignIn" component={SignInScreen} options={hidden} />,
  BirthDate: (
    <Stack.Screen
      name="BirthDate"
      component={BirthDateScreen}
      options={{ ...hidden, gestureEnabled: false }}
    />
  ),
};
