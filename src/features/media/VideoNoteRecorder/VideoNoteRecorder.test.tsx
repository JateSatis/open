import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { VideoNoteRecorder } from '.';

import { MediaLimits } from '@/features/media/constants';

// jest.mock factories may only reference variables whose name starts with `mock`.
const mockRecordAsync = jest.fn();
const mockStopRecording = jest.fn();

jest.mock('expo-camera', () => {
  const { forwardRef, useImperativeHandle } = require('react');
  const { View } = require('react-native');

  const CameraView = forwardRef((props: object, ref: unknown) => {
    useImperativeHandle(ref, () => ({
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

const requestCamera = jest.fn();
const requestMicrophone = jest.fn();

function setPermissions(granted: boolean, canAskAgain = true) {
  (useCameraPermissions as jest.Mock).mockReturnValue([{ granted, canAskAgain }, requestCamera]);
  (useMicrophonePermissions as jest.Mock).mockReturnValue([
    { granted, canAskAgain },
    requestMicrophone,
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  setPermissions(true);
  mockRecordAsync.mockResolvedValue({ uri: 'file:///cache/note.mp4' });
});

describe('VideoNoteRecorder', () => {
  it('records with the video note length limit', async () => {
    const { getByLabelText } = await render(<VideoNoteRecorder onRecorded={jest.fn()} />);

    await fireEvent.press(getByLabelText('Record video message'));

    await waitFor(() =>
      expect(mockRecordAsync).toHaveBeenCalledWith({
        maxDuration: MediaLimits.videoNote.maxDurationMs / 1000,
      }),
    );
  });

  it('hands the recorded note to the caller', async () => {
    const onRecorded = jest.fn();
    const { getByLabelText } = await render(<VideoNoteRecorder onRecorded={onRecorded} />);

    await fireEvent.press(getByLabelText('Record video message'));

    await waitFor(() =>
      expect(onRecorded).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'video_note',
          uri: 'file:///cache/note.mp4',
          mimeType: 'video/mp4',
        }),
      ),
    );
  });

  it('asks for the camera and the microphone before recording', async () => {
    setPermissions(false);
    requestCamera.mockResolvedValue({ granted: false });
    requestMicrophone.mockResolvedValue({ granted: false });
    const { getByLabelText } = await render(<VideoNoteRecorder onRecorded={jest.fn()} />);

    await fireEvent.press(getByLabelText('Record video message'));

    await waitFor(() => expect(requestCamera).toHaveBeenCalled());
    expect(mockRecordAsync).not.toHaveBeenCalled();
  });

  it('does not send a note the user cancelled', async () => {
    let resolveRecording: (value: { uri: string }) => void = () => undefined;
    mockRecordAsync.mockReturnValue(
      new Promise<{ uri: string }>((resolve) => {
        resolveRecording = resolve;
      }),
    );
    const onRecorded = jest.fn();
    const onCancel = jest.fn();
    const { getByLabelText, getByText } = await render(
      <VideoNoteRecorder onRecorded={onRecorded} onCancel={onCancel} />,
    );

    // Not awaited: the press handler stays suspended on `recordAsync` until
    // the recording is resolved further down.
    const started = fireEvent.press(getByLabelText('Record video message'));

    await waitFor(() => expect(getByText('Cancel')).toBeTruthy());
    await fireEvent.press(getByText('Cancel'));
    resolveRecording({ uri: 'file:///cache/note.mp4' });
    await started;

    expect(onCancel).toHaveBeenCalled();
    expect(mockStopRecording).toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('explains a permanently refused camera instead of offering a dead button', async () => {
    setPermissions(false, false);
    const { getByText, queryByLabelText } = await render(
      <VideoNoteRecorder onRecorded={jest.fn()} />,
    );

    expect(getByText(/Camera access is off/)).toBeTruthy();
    expect(queryByLabelText('Record video message')).toBeNull();
  });
});
