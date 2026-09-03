import { createContext, FormEvent, useCallback, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { clearFormDraft, formFields, readFormDraft, writeFormDraft } from "../utils/form-draft";

export const DraftScopeContext = createContext("");

type DraftControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function setNativeProperty(control: DraftControl, property: "value" | "checked", value: string | boolean) {
  const prototype = control instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;
  if (setter) setter.call(control, value);
  else (control as unknown as Record<string, unknown>)[property] = value;
}

export function useFormDraft(key: string) {
  const scope = useContext(DraftScopeContext);
  const formId = useMemo(() => key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 160), [key]);
  const initialFields = useMemo(() => readFormDraft(scope, key) ?? {}, [scope, key]);
  const restoredControls = useRef(new WeakSet<DraftControl>());
  const restoring = useRef(false);
  const restored = Object.keys(initialFields).length > 0;

  useLayoutEffect(() => {
    const form = document.querySelector<HTMLFormElement>(`form[data-form-draft-key="${formId}"]`);
    if (!form) return;
    restoring.current = true;
    for (const control of Array.from(form.elements)) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
      if (!control.name || restoredControls.current.has(control) || !(control.name in initialFields)) continue;
      if (control instanceof HTMLInputElement && ["password", "file", "hidden"].includes(control.type)) continue;
      const values = initialFields[control.name] ?? [];
      if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
        setNativeProperty(control, "checked", values.includes(control.value));
      } else if (control instanceof HTMLSelectElement && control.multiple) {
        for (const option of Array.from(control.options)) option.selected = values.includes(option.value);
      } else {
        setNativeProperty(control, "value", values[0] ?? "");
      }
      restoredControls.current.add(control);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    restoring.current = false;
  });

  const persist = useCallback((event: FormEvent<HTMLFormElement>) => {
    if (!restoring.current) writeFormDraft(scope, key, formFields(event.currentTarget));
  }, [key, scope]);

  const clear = useCallback(() => clearFormDraft(scope, key), [key, scope]);
  const save = useCallback((fields: Record<string, string | string[]>) => {
    writeFormDraft(scope, key, Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, Array.isArray(value) ? value : [value]])));
  }, [key, scope]);

  return {
    clear,
    save,
    restored,
    has: (name: string) => name in initialFields,
    initialValue: (name: string, fallback = "") => initialFields[name]?.[0] ?? fallback,
    formProps: {
      "data-form-draft-key": formId,
      onInputCapture: persist,
      onChangeCapture: persist,
    },
  };
}
