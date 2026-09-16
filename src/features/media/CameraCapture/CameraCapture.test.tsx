import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { CameraCapture } from '.';

import { compressImage } from '@/features/media/lib/compressImage';
import { MediaLimits } from '@/features/media/constants';

const mockTakePictureAsync = jest.fn();
const mockRecordAsync = jest.fn();
const mockStopRecording = jest.fn();

jest.mock('expo-camera', () => {
  const { forwardRef, useImperativeHandle } = require('react');
  const { View } = require('react-native');

  const CameraView = forwardRef((props: object, ref: unknown) => {
    useImperativeHandle(ref, () => ({
      takePictureAsync: mockTakePictureAsync,
      recordAsync: mockRecordAsync,
      stopRecording: mockStopRecording,
    }));
    return <View {...props} />;
  });

  CameraView.displayName = 'CameraView';

  return {
    useCameraPermissions: jest.fn(),
    useMicrophonePermissions: jest.fn(),
    CameraView,
  };
});

jest.mock('@/features/media/lib/compressImage', () => ({
  compressImage: jest.fn((media) => Promise.resolve({ ...media, uri: 'file:///cache/small.jpg' })),
}));

const requestCamera = jest.fn();
const requestMicrophone = jest.fn();

function setCameraPermission(granted: boolean, canAskAgain = true) {
  (useCameraPermissions as jest.Mock).mockReturnValue([{ granted, canAskAgain }, requestCamera]);
}

beforeEach(() => {
  jest.clearAllMocks();
  setCameraPermission(true);
  (useMicrophonePermissions as jest.Mock).mockReturnValue([{ granted: true }, requestMicrophone]);
  requestMicrophone.mockResolvedValue({ granted: true });
  mockTakePictureAsync.mockResolvedValue({
    uri: 'file:///cache/IMG.jpg',
    width: 4032,
    height: 3024,
    format: 'jpg',
  });
  mockRecordAsync.mockResolvedValue({ uri: 'file:///cache/clip.mp4' });
});

describe('CameraCapture', () => {
  it('compresses a photo before handing it over', async () => {
    const onCaptured = jest.fn();
    const { getByLabelText } = await render(<CameraCapture onCaptured={onCaptured} />);

    await fireEvent.press(getByLabelText('Take photo'));

    await waitFor(() => expect(compressImage).toHaveBeenCalled());
    expect(onCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'photo', uri: 'file:///cache/small.jpg' }),
    );
  });

  it('records a video with the length limit and reports its duration', async () => {
    const onCaptured = jest.fn();
    const { getByLabelText, getByText } = await render(
      <CameraCapture onCaptured={onCaptured} modes={['photo', 'video']} />,
    );

    await fireEvent.press(getByText('Video'));
    await fireEvent.press(getByLabelText('Record video'));

    await waitFor(() =>
      expect(mockRecordAsync).toHaveBeenCalledWith({
        maxDuration: MediaLimits.video.maxDurationMs / 1000,
      }),
    );
    expect(onCaptured).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'video',
        uri: 'file:///cache/clip.mp4',
        durationMs: expect.any(Number),
      }),
    );
  });

  it('does not record video without the microphone', async () => {
    requestMicrophone.mockResolvedValue({ granted: false });
    const { getByLabelText, getByText } = await render(
      <CameraCapture onCaptured={jest.fn()} modes={['photo', 'video']} />,
    );

    await fireEvent.press(getByText('Video'));
    await fireEvent.press(getByLabelText('Record video'));

    await waitFor(() => expect(requestMicrophone).toHaveBeenCalled());
    expect(mockRecordAsync).not.toHaveBeenCalled();
  });

  it('offers only the photo shutter when video is not on the menu', async () => {
    const { queryByText } = await render(
      <CameraCapture onCaptured={jest.fn()} modes={['photo']} />,
    );

    expect(queryByText('Video')).toBeNull();
  });

  it('asks for the camera instead of showing a black preview', async () => {
    setCameraPermission(false);
    const { getByText, queryByTestId } = await render(<CameraCapture onCaptured={jest.fn()} />);

    await fireEvent.press(getByText('Allow camera'));

    expect(requestCamera).toHaveBeenCalled();
    expect(queryByTestId('camera-capture-preview')).toBeNull();
  });

  it('does not offer a retry once the camera is permanently refused', async () => {
    setCameraPermission(false, false);
    const { getByText, queryByText } = await render(<CameraCapture onCaptured={jest.fn()} />);

    expect(getByText(/Camera access is off/)).toBeTruthy();
    expect(queryByText('Allow camera')).toBeNull();
  });
});
