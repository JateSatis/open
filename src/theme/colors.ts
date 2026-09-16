import '@/global.css';

export const Colors = {
  light: {
    text: '#000000',
    textSecondary: '#60646C',
    textInverse: '#ffffff',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    border: '#E0E1E6',
    primary: '#3C87F7',
    primaryText: '#ffffff',
    danger: '#E5484D',
    success: '#30A46C',
  },
  dark: {
    text: '#ffffff',
    textSecondary: '#B0B4BA',
    textInverse: '#000000',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    border: '#2E3135',
    primary: '#3C87F7',
    primaryText: '#ffffff',
    danger: '#FF6369',
    success: '#3DD68C',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
