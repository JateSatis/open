import { PopEditor } from '@/features/pops/PopEditor';
import { PopViewerScreen } from '@/features/pops/PopViewerScreen';
import { hidden, Stack } from './rootStack';

export const feedRoutes = (
  <>
    <Stack.Screen name="PopEditor" component={PopEditor} options={hidden} />
    <Stack.Screen
      name="PopViewer"
      component={PopViewerScreen}
      options={{
        ...hidden,
        statusBarStyle: 'light',
        contentStyle: { backgroundColor: 'black' },
      }}
    />
  </>
);
