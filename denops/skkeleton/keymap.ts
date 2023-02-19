import { config } from "./config.ts";
import type { Context } from "./context.ts";
import { Func, functions, functionsWithArgs } from "./function.ts";
import { cancel, kakutei, newline, purgeCandidate } from "./function/common.ts";
import { escape } from "./function/disable.ts";
import {
  henkanBackward,
  henkanFirst,
  henkanForward,
  henkanInput,
} from "./function/henkan.ts";
import { deleteChar, kanaInput } from "./function/input.ts";
import { hankatakana } from "./function/mode.ts";
import { notationToKey } from "./notation.ts";

type KeyMap = {
  default: Func;
  map: Record<string, Func>;
};

const input: KeyMap = {
  default: kanaInput,
  map: {
    "<bs>": deleteChar,
    "<c-g>": cancel,
    "<c-h>": deleteChar,
    "<cr>": newline,
    "<esc>": escape,
    "<nl>": kakutei,
    "<c-q>": hankatakana,
    "<c-space>": henkanFirst,
    "<s-space>": henkanFirst,
  },
};

const henkan: KeyMap = {
  default: henkanInput,
  map: {
    "<c-g>": cancel,
    "<cr>": newline,
    "<nl>": kakutei,
    "<space>": henkanForward,
    "<s-space>": henkanForward,
    "<c-space>": henkanForward,
    "x": henkanBackward,
    "X": purgeCandidate,
  },
};

const keyMaps: Record<string, KeyMap> = {
  "input": input,
  "henkan": henkan,
};

export async function handleKey(context: Context, key: string) {
  const keyMap = keyMaps[context.state.type];
  if (!keyMap) {
    throw new Error("Illegal State: " + context.state.type);
  }
  if (config.debug) {
    console.log(`handleKey: ${key}`);
  }
  await ((keyMap.map[key] ?? keyMap.default)(
    context,
    notationToKey[key] ?? key,
  ) ?? Promise.resolve());
}

export function registerKeyMap(state: string, key: string, func: unknown) {
  if (config.debug) {
    console.log(`registerKeyMap: state = ${state} key = ${key} func = ${func}`);
  }
  const keyMap = keyMaps[state];
  if (!keyMap) {
    throw Error(`unknown state: ${state}`);
  }
  if (!func) {
    delete keyMap.map[key];
    return;
  }

  const [funcName, args] = String(func).split("-");
  const fn = args
    ? functionsWithArgs.get()[funcName]?.(args)
    : functions.get()[funcName];
  if (!fn) {
    throw Error(`unknown function: ${func}`);
  }
  keyMap.map[key] = fn;

  if (config.debug) {
    console.log(keyMap);
  }
}
