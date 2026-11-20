import { useIsFocused } from '@react-navigation/native';
import { type ReactElement, useEffect, useState } from 'react';
import { View } from 'react-native';

/** У стека и вкладок layout контейнера может прийти раньше layout активного экрана. */
export function StartupScreenLayout({
  children,
  onReady,
}: {
  children: ReactElement;
  onReady: () => void;
}) {
  const focused = useIsFocused();
  const [laidOut, setLaidOut] = useState(false);
  useEffect(() => {
    if (focused && laidOut) onReady();
  }, [focused, laidOut, onReady]);

  return (
    <View
      style={{ flex: 1 }}
      onLayout={({ nativeEvent: { layout } }) => {
        setLaidOut(layout.width > 0 && layout.height > 0);
      }}
    >
      {children}
    </View>
  );
}
