import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignInScreen from './sign-in';

import { signInWithApple, signInWithGoogle } from '@/features/auth/signIn';
import { signInMessages } from '@/features/auth/signInErrors';
import { useAppleSignInAvailable } from '@/features/auth/useAppleSignInAvailable';

jest.mock('@/features/auth/signIn', () => ({
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
}));

jest.mock('@/features/auth/useAppleSignInAvailable', () => ({
  useAppleSignInAvailable: jest.fn(),
}));

const googleSignIn = signInWithGoogle as jest.Mock;
const appleSignIn = signInWithApple as jest.Mock;
const appleAvailable = useAppleSignInAvailable as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  appleAvailable.mockReturnValue(true);
  googleSignIn.mockResolvedValue({ status: 'success' });
  appleSignIn.mockResolvedValue({ status: 'success' });
});

describe('SignInScreen', () => {
  it('offers Google and Apple when both are available', async () => {
    await render(<SignInScreen />);

    expect(screen.getByText('Продолжить с Google')).toBeTruthy();
    expect(screen.getByText('Продолжить с Apple')).toBeTruthy();
  });

  it('hides the Apple button where Sign in with Apple does not exist', async () => {
    appleAvailable.mockReturnValue(false);

    await render(<SignInScreen />);

    expect(screen.queryByText('Продолжить с Apple')).toBeNull();
  });

  it('does not promise privacy the product does not have', async () => {
    await render(<SignInScreen />);

    expect(screen.getByText(/переписка публична/i)).toBeTruthy();
  });

  it('starts the Google flow on press', async () => {
    await render(<SignInScreen />);

    fireEvent.press(screen.getByText('Продолжить с Google'));

    await waitFor(() => expect(googleSignIn).toHaveBeenCalledTimes(1));
  });

  it('starts the Apple flow on press', async () => {
    await render(<SignInScreen />);

    await act(() => fireEvent.press(screen.getByText('Продолжить с Apple')));

    await waitFor(() => expect(appleSignIn).toHaveBeenCalledTimes(1));
  });

  it('shows why the sign-in failed', async () => {
    googleSignIn.mockResolvedValue({ status: 'error', message: signInMessages.network });

    await render(<SignInScreen />);

    await act(() => fireEvent.press(screen.getByText('Продолжить с Google')));

    expect(await screen.findByText(signInMessages.network)).toBeTruthy();
  });

  it('stays quiet when the user cancels', async () => {
    googleSignIn.mockResolvedValue({ status: 'cancelled' });

    await render(<SignInScreen />);

    fireEvent.press(screen.getByText('Продолжить с Google'));

    await waitFor(() => expect(googleSignIn).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(signInMessages.network)).toBeNull();
    expect(screen.queryByText(signInMessages.generic)).toBeNull();
  });

  it('clears a previous error when the user retries', async () => {
    googleSignIn.mockResolvedValue({ status: 'error', message: signInMessages.generic });

    await render(<SignInScreen />);

    await act(() => fireEvent.press(screen.getByText('Продолжить с Google')));
    expect(await screen.findByText(signInMessages.generic)).toBeTruthy();

    googleSignIn.mockResolvedValue({ status: 'success' });
    fireEvent.press(screen.getByText('Продолжить с Google'));

    await waitFor(() => expect(screen.queryByText(signInMessages.generic)).toBeNull());
  });

  it('blocks a second provider while one sign-in is running', async () => {
    let finishGoogle: (result: { status: 'success' }) => void = () => {};
    googleSignIn.mockReturnValue(
      new Promise<{ status: 'success' }>((resolve) => {
        finishGoogle = resolve;
      }),
    );

    await render(<SignInScreen />);

    fireEvent.press(screen.getByText('Продолжить с Google'));

    await waitFor(() =>
      expect(screen.getByText('Продолжить с Apple').parent?.props.accessibilityState).toMatchObject(
        { disabled: true },
      ),
    );

    fireEvent.press(screen.getByText('Продолжить с Apple'));
    expect(appleSignIn).not.toHaveBeenCalled();

    await act(async () => finishGoogle({ status: 'success' }));
  });
});
