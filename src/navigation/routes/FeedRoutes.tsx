import * as Screens from '@/navigation/screens';
import { hidden, Stack } from './rootStack';

export const feedRoutes = (
  <>
    <Stack.Screen name="PopEditor" component={Screens.PopEditorRoute} options={hidden} />
    <Stack.Screen
      name="PopViewer"
      component={Screens.PopViewerRoute}
      options={{
        ...hidden,
        statusBarStyle: 'light',
        contentStyle: { backgroundColor: 'black' },
      }}
    />
  </>
);
