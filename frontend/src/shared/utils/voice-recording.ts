export const VOICE_RECORDING_LIMIT_MS = 60_000;
export const VOICE_MIN_RECORDING_MS = 1_000;
export const VOICE_AUDIO_TIMESLICE_MS = 250;

export const VOICE_RECORDING_TOO_SHORT_MESSAGE =
  "The recording is too short. Speak for at least 1 second, then press Stop.";

type FinalizableRecorder = {
  requestData?: () => void;
  stop: () => void;
};

export function flushAndStopRecorder(recorder: FinalizableRecorder) {
  try {
    recorder.requestData?.();
  } catch {
    // stop() still asks MediaRecorder for its final data on browsers that reject requestData().
  }
  recorder.stop();
}

export function isVoiceRecordingLongEnough(durationMs: number) {
  return Number.isFinite(durationMs) && durationMs >= VOICE_MIN_RECORDING_MS;
}
