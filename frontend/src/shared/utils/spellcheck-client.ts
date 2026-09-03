import type { SpellcheckIssue } from "./spellcheck";

type SpellcheckResponse = { id: number; issues?: SpellcheckIssue[]; error?: string };

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<number, { resolve: (issues: SpellcheckIssue[]) => void; reject: (error: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./spellcheck.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<SpellcheckResponse>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.issues ?? []);
  };
  worker.onerror = () => {
    const error = new Error("The local spelling dictionaries could not be loaded.");
    pending.forEach((request) => request.reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function checkSpelling(text: string) {
  if (typeof Worker === "undefined") return Promise.reject(new Error("Spellcheck is not supported by this browser."));
  const id = ++requestId;
  return new Promise<SpellcheckIssue[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text });
  });
}
