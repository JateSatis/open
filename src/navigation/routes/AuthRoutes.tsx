import * as Screens from '@/navigation/screens';
import { hidden, Stack } from './rootStack';

export const authRoutes = {
  SignIn: <Stack.Screen name="SignIn" component={Screens.SignInScreen} options={hidden} />,
  BirthDate: (
    <Stack.Screen
      name="BirthDate"
      component={Screens.BirthDateScreen}
      options={{ ...hidden, gestureEnabled: false }}
    />
  ),
};
