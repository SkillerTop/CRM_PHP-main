declare module "nspell" {
  export type Dictionary = { aff: string | Uint8Array; dic?: string | Uint8Array };
  export type NSpell = {
    correct: (word: string) => boolean;
    suggest: (word: string) => string[];
    add: (word: string, model?: string) => NSpell;
  };
  export default function nspell(dictionary: Dictionary): NSpell;
}
