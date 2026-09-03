import { useEffect, useRef, useState } from "react";
import { apiMessage, apiRequest } from "../api/api-client";
import { checkSpelling } from "../utils/spellcheck-client";
import { replaceSpellingIssue, type SpellcheckIssue } from "../utils/spellcheck";
import {
  flushAndStopRecorder,
  isVoiceRecordingLongEnough,
  VOICE_AUDIO_TIMESLICE_MS,
  VOICE_RECORDING_LIMIT_MS,
  VOICE_RECORDING_TOO_SHORT_MESSAGE,
} from "../utils/voice-recording";

export { VOICE_RECORDING_LIMIT_MS };

const speechBackendUrl = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:8080`
  : "";

type VoiceState = "idle" | "starting" | "recording" | "transcribing";

function preferredAudioType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function audioExtension(type: string) {
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4")) return "m4a";
  return "webm";
}

function recordingTime(seconds: number) {
  return `0:${String(seconds).padStart(2, "0")}`;
}

export function VoiceInputButton({ onText, disabled = false }: { onText: (text: string) => void; disabled?: boolean }) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const stopRequestedAtRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const discardRef = useRef(false);
  const mountedRef = useRef(true);
  const onTextRef = useRef(onText);
  const [state, setState] = useState<VoiceState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => { onTextRef.current = onText; }, [onText]);

  function clearTimers() {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  }

  function releaseMicrophone() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRef.current = true;
      clearTimers();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseMicrophone();
    };
  }, []);

  async function transcribe(mimeType: string, durationMs: number) {
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
      if (blob.size === 0) throw new Error("No audio was captured. Check the selected microphone and try again.");
      const body = new FormData();
      body.append("file", blob, `voice.${audioExtension(blob.type)}`);
      body.append("duration_seconds", String(Math.min(60, Math.max(1, Math.ceil(durationMs / 1000)))));
      const response = await apiRequest<{ data: { text: string } }>(
        "/speech/transcribe",
        { method: "POST", body },
        speechBackendUrl,
      );
      const text = response.data.text.trim();
      if (text) onTextRef.current(text);
    } catch (caught) {
      if (mountedRef.current) setError(apiMessage(caught));
    } finally {
      chunksRef.current = [];
      recorderRef.current = null;
      stopRequestedAtRef.current = 0;
      if (mountedRef.current) {
        setElapsedSeconds(0);
        setState("idle");
      }
    }
  }

  function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    clearTimers();
    stopRequestedAtRef.current = Date.now();
    setState("transcribing");
    try {
      flushAndStopRecorder(recorder);
    } catch (caught) {
      discardRef.current = true;
      releaseMicrophone();
      chunksRef.current = [];
      recorderRef.current = null;
      stopRequestedAtRef.current = 0;
      setElapsedSeconds(0);
      setState("idle");
      setError(apiMessage(caught));
    }
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice input is not supported by this browser.");
      return;
    }

    try {
      setState("starting");
      setError("");
      setElapsedSeconds(0);
      chunksRef.current = [];
      discardRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = preferredAudioType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      stopRequestedAtRef.current = 0;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        clearTimers();
        releaseMicrophone();
        const stoppedAt = stopRequestedAtRef.current || Date.now();
        const durationMs = Math.max(0, stoppedAt - startedAtRef.current);
        if (discardRef.current) {
          chunksRef.current = [];
          recorderRef.current = null;
          stopRequestedAtRef.current = 0;
          return;
        }
        if (!isVoiceRecordingLongEnough(durationMs)) {
          chunksRef.current = [];
          recorderRef.current = null;
          stopRequestedAtRef.current = 0;
          if (mountedRef.current) {
            setElapsedSeconds(0);
            setState("idle");
            setError(VOICE_RECORDING_TOO_SHORT_MESSAGE);
          }
          return;
        }
        void transcribe(recorder.mimeType || mimeType, durationMs);
      };
      recorder.onerror = () => {
        discardRef.current = true;
        clearTimers();
        releaseMicrophone();
        chunksRef.current = [];
        recorderRef.current = null;
        stopRequestedAtRef.current = 0;
        if (mountedRef.current) {
          setElapsedSeconds(0);
          setState("idle");
          setError("The browser could not record audio. Check the selected microphone and try again.");
        }
      };
      recorder.start(VOICE_AUDIO_TIMESLICE_MS);
      setState("recording");
      intervalRef.current = window.setInterval(() => {
        setElapsedSeconds(Math.min(60, Math.floor((Date.now() - startedAtRef.current) / 1000)));
      }, 250);
      timeoutRef.current = window.setTimeout(stop, VOICE_RECORDING_LIMIT_MS);
    } catch (caught) {
      clearTimers();
      releaseMicrophone();
      recorderRef.current = null;
      setState("idle");
      setError(caught instanceof DOMException && caught.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in the browser settings and try again."
        : apiMessage(caught));
    }
  }

  return (
    <span className="voice-input">
      <button className={state === "recording" ? "danger-button" : "secondary-button"} type="button" disabled={disabled || state === "starting" || state === "transcribing"} aria-pressed={state === "recording"} onClick={() => state === "recording" ? stop() : void start()}>
        {state === "recording" ? `■ Stop · ${recordingTime(elapsedSeconds)} / 1:00` : state === "starting" ? "Starting microphone…" : state === "transcribing" ? "Recognizing…" : "🎙 Voice · up to 1 min"}
      </button>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}

export function appendVoiceText(current: string, text: string, maxLength: number) {
  const clean = text.trim();
  if (!clean) return current;
  const combined = current.trim() ? `${current.trim()}\n${clean}` : clean;
  return combined.slice(0, maxLength);
}

export function VoiceTextTools({ value, onChange, maxLength, disabled = false, draftRestored = false }: {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled?: boolean;
  draftRestored?: boolean;
}) {
  const checkSequenceRef = useRef(0);
  const [spellcheckResult, setSpellcheckResult] = useState<{
    text: string;
    state: "loading" | "ready" | "error";
    issues: SpellcheckIssue[];
  }>({ text: "", state: "ready", issues: [] });

  useEffect(() => {
    const sequence = ++checkSequenceRef.current;
    if (!/[\p{L}]{2}/u.test(value)) return;

    const timer = window.setTimeout(() => {
      setSpellcheckResult({ text: value, state: "loading", issues: [] });
      void checkSpelling(value)
        .then((issues) => {
          if (sequence !== checkSequenceRef.current) return;
          setSpellcheckResult({ text: value, state: "ready", issues });
        })
        .catch(() => {
          if (sequence !== checkSequenceRef.current) return;
          setSpellcheckResult({ text: value, state: "error", issues: [] });
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [value]);

  const hasCheckableText = /[\p{L}]{2}/u.test(value);
  const spellcheckState = !hasCheckableText
    ? "idle"
    : spellcheckResult.text === value
      ? spellcheckResult.state
      : "loading";
  const spellcheckIssues = spellcheckResult.text === value ? spellcheckResult.issues : [];
  const spellcheckSummary = spellcheckState === "idle"
    ? "Enter or dictate text to check spelling."
    : spellcheckState === "loading"
      ? "Checking text against local dictionaries…"
      : spellcheckState === "error"
        ? "Local spelling dictionaries could not be loaded."
        : spellcheckIssues.length === 0
          ? "No spelling errors found."
          : `${spellcheckIssues.length} possible spelling ${spellcheckIssues.length === 1 ? "error" : "errors"}.`;

  return (
    <div className="voice-text-tools">
      <VoiceInputButton disabled={disabled} onText={(text) => onChange(appendVoiceText(value, text, maxLength))} />
      <div className={`spellcheck-panel ${spellcheckIssues.length > 0 ? "has-issues" : ""}`} aria-label="Spelling corrections" aria-live="polite">
        <div className="spellcheck-summary"><small>Spelling</small><span>{spellcheckSummary}</span></div>
        {spellcheckIssues.map((issue) => (
          <div className="spellcheck-issue" key={issue.id}>
            <span className="spellcheck-source"><del>{issue.word}</del><span aria-hidden="true">→</span></span>
            <span className="spellcheck-suggestions">
              {issue.suggestions.length > 0
                ? issue.suggestions.map((suggestion) => <button type="button" disabled={disabled} key={suggestion} onClick={() => onChange(replaceSpellingIssue(value, issue, suggestion).slice(0, maxLength))}>{suggestion}</button>)
                : <small>No dictionary suggestion</small>}
            </span>
          </div>
        ))}
      </div>
      <small className="voice-draft-status">{draftRestored ? "Draft restored from protected browser storage." : "Draft is kept in protected browser storage and an encrypted cookie until saved."}</small>
    </div>
  );
}
