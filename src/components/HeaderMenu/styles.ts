import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    // Меню вырастает из-под «⋮» — оттуда, где его ждёт палец.
    transformOrigin: 'top right',
  },
});
