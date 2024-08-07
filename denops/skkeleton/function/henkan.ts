import { modifyCandidate } from "../candidate.ts";
import { config } from "../config.ts";
import type { Context } from "../context.ts";
import type { Denops } from "../deps.ts";
import { currentLibrary } from "../store.ts";
import { handleKey } from "../keymap.ts";
import { keyToNotation } from "../notation.ts";
import { getOkuriStr } from "../okuri.ts";
import { HenkanState, initializeState } from "../state.ts";
import { kakutei } from "./common.ts";
import { acceptResult, henkanPoint, kakuteiFeed } from "./input.ts";
import { registerWord } from "./dictionary.ts";

export async function henkanFirst(context: Context, key: string) {
  if (context.state.type !== "input") {
    return;
  }

  kakuteiFeed(context);

  if (context.state.mode === "direct") {
    context.kakutei(key);
    return;
  }

  if (context.state.henkanFeed === "") {
    return;
  }

  const state = context.state as unknown as HenkanState;
  state.type = "henkan";
  state.candidates = [];
  state.candidateIndex = -1;

  const lib = await currentLibrary.get();
  const word = state.mode === "okurinasi"
    ? state.henkanFeed
    : getOkuriStr(state.henkanFeed, state.okuriFeed);
  state.word = word;
  if (
    state.affix == null &&
    !state.directInput &&
    ["okurinasi", "okuriari"].includes(state.mode)
  ) {
    // When user maunally uses henkanPoint,
    // henkanFeed like `>prefix` and `suffix>` may
    // reach here with undefined affix
    state.affix = state.henkanFeed.match(">$")
      ? "prefix"
      : state.henkanFeed.match("^>")
      ? "suffix"
      : undefined;
  }
  state.candidates = await lib.getHenkanResult(state.mode, word);
  await henkanForward(context);
}

export async function henkanForward(context: Context) {
  const state = context.state;
  if (state.type !== "henkan") {
    return;
  }
  const oldCandidateIndex = state.candidateIndex;
  if (state.candidateIndex >= config.showCandidatesCount) {
    state.candidateIndex += 7;
  } else {
    state.candidateIndex++;
  }
  if (state.candidates.length <= state.candidateIndex) {
    if (await registerWord(context)) {
      return;
    }
    state.candidateIndex = oldCandidateIndex;
    if (state.candidateIndex === -1) {
      context.state.type = "input";
    }
  }
  if (state.candidateIndex >= config.showCandidatesCount) {
    if (config.usePopup && context.vimMode === "i") {
      await showCandidates(context.denops!, state);
    } else {
      await selectCandidates(context);
    }
  }
}

export async function henkanBackward(context: Context) {
  const state = context.state;
  if (state.type !== "henkan") {
    return;
  }
  if (state.candidateIndex >= config.showCandidatesCount) {
    state.candidateIndex = Math.max(
      state.candidateIndex - 7,
      config.showCandidatesCount - 1,
    );
  } else {
    state.candidateIndex--;
  }
  if (state.candidateIndex < 0) {
    context.state.type = "input";
    return;
  }
  if (state.candidateIndex >= config.showCandidatesCount) {
    await showCandidates(context.denops!, state);
  }
}

async function selectCandidates(context: Context) {
  const state = context.state as HenkanState;
  const denops = context.denops!;
  const count = config.showCandidatesCount;
  const keys = config.selectCandidateKeys;
  let index = 0;
  while (index >= 0) {
    const start = count + index * keys.length;
    if (start >= state.candidates.length) {
      if (await registerWord(context)) {
        return;
      }
    }
    const candidates = state.candidates.slice(start, start + keys.length);
    const msg = candidates.map((c, i) =>
      `${keys[i]}: ${modifyCandidate(c, state.affix)}`
    ).join(" ");
    let keyCode: number;
    try {
      keyCode = await denops.call("skkeleton#getchar", msg) as number;
    } catch (e: unknown) {
      // Note: Ctrl-C is interrupt
      //       Manually convert to key code
      if (String(e).match(/[Ii]nterrput/)) {
        keyCode = 3;
      } else {
        throw e;
      }
    }
    // Cancel select by <C-c> or <C-g> or <Esc>
    if (keyCode == 3 || keyCode == 7 || keyCode == 27) {
      if (config.immediatelyCancel) {
        initializeState(context.state);
      }
      return;
    }
    const key = String.fromCharCode(keyCode);
    if (key === " ") {
      index += 1;
    } else if (key === "x") {
      index -= 1;
    } else {
      const candIndex = keys.indexOf(key);
      if (candIndex !== -1) {
        if (start + candIndex < state.candidates.length) {
          state.candidateIndex = start + candIndex;
          await kakutei(context);
          return;
        }
      }
    }
  }
  state.candidateIndex = config.showCandidatesCount - 1;
}

async function showCandidates(denops: Denops, state: HenkanState) {
  const idx = state.candidateIndex;
  const candidates = state.candidates.slice(idx, idx + 7);
  const list = candidates.map((c, i) =>
    `${config.selectCandidateKeys[i]}: ${modifyCandidate(c, state.affix)}`
  );
  await denops.call("skkeleton#popup#open", list);
}

export async function henkanInput(context: Context, key: string) {
  const state = context.state as HenkanState;
  if (state.candidateIndex >= config.showCandidatesCount) {
    const candIdx = config.selectCandidateKeys.indexOf(key);
    if (candIdx !== -1) {
      if (state.candidateIndex + candIdx < state.candidates.length) {
        state.candidateIndex += candIdx;
        await kakutei(context);
      }
      return;
    }
  }

  await kakutei(context);
  await handleKey(context, keyToNotation[key] ?? key);
}

export function upper(key: string) {
  return async function (context: Context) {
    henkanPoint(context);
    await handleKey(context, key);
  };
}

export async function suffix(context: Context) {
  if (context.state.type !== "henkan") {
    return;
  }

  await kakutei(context);
  henkanPoint(context);
  await acceptResult(context, [">", ""], "");
  context.state.affix = "suffix";
}
