import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { HiddenTextSpans } from '.';

describe('HiddenTextSpans', () => {
  it('К1.1 зрителю — замазка той же длины вместо скрытого, с пояснением', async () => {
    await render(
      <Text testID="body">
        <HiddenTextSpans text="учусь: ••••••••, класс 7Б" ranges={[{ start: 7, end: 15 }]} />
      </Text>,
    );

    const spoiler = screen.getByTestId('hidden-text-spoiler');

    expect(spoiler).toHaveTextContent('••••••••');
    expect(spoiler.props.accessibilityLabel).toBe('Скрыто автором от зрителей');
    // Нечего раскрывать: у замазки нет нажатия.
    expect(spoiler.props.onPress).toBeUndefined();
    expect(screen.getByTestId('body')).toHaveTextContent('учусь: ••••••••, класс 7Б');
  });

  it('К1.1 участнику — оригинал с тихой пометкой', async () => {
    await render(
      <Text>
        <HiddenTextSpans text="учусь: школа 57, класс 7Б" ranges={[{ start: 7, end: 15 }]} />
      </Text>,
    );

    expect(screen.getByTestId('hidden-text-mark')).toHaveTextContent('школа 57');
    expect(screen.queryByTestId('hidden-text-spoiler')).toBeNull();
  });

  it('К1.9 без скрытого — просто текст', async () => {
    await render(
      <Text testID="body">
        <HiddenTextSpans text="обычное сообщение" ranges={[]} />
      </Text>,
    );

    expect(screen.getByTestId('body')).toHaveTextContent('обычное сообщение');
    expect(screen.queryByTestId('hidden-text-mark')).toBeNull();
  });
});
