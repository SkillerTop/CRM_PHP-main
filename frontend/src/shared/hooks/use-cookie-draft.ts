import { Dispatch, SetStateAction, useCallback, useContext, useEffect, useRef, useState } from "react";
import { clearFormDraft, readFormDraft, writeFormDraft } from "../utils/form-draft";
import {
  clearSecureVoiceDraft,
  clearVoiceDraft,
  readSecureVoiceDraft,
  readVoiceDraft,
  writeSecureVoiceDraft,
} from "../utils/voice-draft";
import { DraftScopeContext } from "./use-form-draft";

export function useCookieDraft(key: string, initialValue: string): [string, Dispatch<SetStateAction<string>>, () => void, boolean] {
  const scope = useContext(DraftScopeContext);
  const secureKey = `voice:${key}`;
  const identity = `${scope}\0${secureKey}`;
  const skipPersistenceRef = useRef(false);
  const cookieOperationRef = useRef(0);
  const cookieQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [draft, setDraft] = useState(() => {
    const restored = readFormDraft(scope, secureKey)?.value?.[0] ?? null;
    return {
      identity,
      value: restored ?? initialValue,
      restored: restored !== null,
      ready: !scope || restored !== null,
      dirty: false,
    };
  });

  const enqueueCookieOperation = useCallback((operation: () => Promise<unknown> | unknown) => {
    const generation = ++cookieOperationRef.current;
    cookieQueueRef.current = cookieQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== cookieOperationRef.current) return;
        await operation();
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // Remove legacy plaintext cookie drafts. Current voice cookies are encrypted and account-scoped.
    if (typeof document !== "undefined" && readVoiceDraft(key) !== null) clearVoiceDraft(key);
  }, [key]);

  useEffect(() => {
    const restored = readFormDraft(scope, secureKey)?.value?.[0] ?? null;
    setDraft((current) => current.identity === identity ? current : {
      identity,
      value: restored ?? initialValue,
      restored: restored !== null,
      ready: !scope || restored !== null,
      dirty: false,
    });
  }, [identity, initialValue, scope, secureKey]);

  useEffect(() => {
    if (!scope || draft.identity !== identity || draft.ready) return;
    let active = true;
    void readSecureVoiceDraft(scope, secureKey).then((restored) => {
      if (!active) return;
      setDraft((current) => {
        if (current.identity !== identity || current.dirty) return current;
        if (restored !== null) {
          writeFormDraft(scope, secureKey, { value: [restored] });
          return { ...current, value: restored, restored: true, ready: true };
        }
        return { ...current, value: initialValue, ready: true };
      });
    }).catch(() => {
      if (active) setDraft((current) => current.identity === identity ? { ...current, ready: true } : current);
    });
    return () => { active = false; };
  }, [draft.identity, draft.ready, identity, initialValue, scope, secureKey]);

  const setValue: Dispatch<SetStateAction<string>> = useCallback((next) => {
    setDraft((current) => ({
      ...current,
      value: typeof next === "function" ? next(current.value) : next,
      restored: false,
      ready: true,
      dirty: true,
    }));
  }, []);

  useEffect(() => {
    if (draft.identity !== identity || !draft.ready || !scope) return;
    if (skipPersistenceRef.current) {
      skipPersistenceRef.current = false;
      return;
    }
    if (!draft.restored && draft.value === initialValue) {
      clearFormDraft(scope, secureKey);
      enqueueCookieOperation(() => clearSecureVoiceDraft(scope, secureKey));
      return;
    }
    writeFormDraft(scope, secureKey, { value: [draft.value] });
    enqueueCookieOperation(() => writeSecureVoiceDraft(scope, secureKey, draft.value));
  }, [draft.identity, draft.ready, draft.restored, draft.value, enqueueCookieOperation, identity, initialValue, scope, secureKey]);

  const clear = useCallback(() => {
    skipPersistenceRef.current = true;
    clearFormDraft(scope, secureKey);
    enqueueCookieOperation(() => clearSecureVoiceDraft(scope, secureKey));
    setDraft((current) => ({ ...current, restored: false, dirty: false }));
  }, [enqueueCookieOperation, scope, secureKey]);

  return [draft.value, setValue, clear, draft.restored];
}
