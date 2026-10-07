import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    // Меню вырастает из угла над кнопкой — оттуда, где его ждёт палец.
    transformOrigin: 'bottom left',
  },
});
