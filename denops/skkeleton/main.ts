import { config, setConfig } from "./config.ts";
import { autocmd, Denops, fn, op, vars } from "./deps.ts";
import {
  AssertError,
  assertObject,
  assertString,
  isString,
} from "./deps/unknownutil.ts";
import { functions } from "./function.ts";
import { disable as disableFunc } from "./function/disable.ts";
import { initializeStateWithAbbrev, modeChange } from "./mode.ts";
import { load as jisyoLoad, SkkServer } from "./jisyo.ts";
import { currentKanaTable, registerKanaTable } from "./kana.ts";
import { handleKey, registerKeyMap } from "./keymap.ts";
import { keyToNotation, notationToKey, receiveNotation } from "./notation.ts";
import { currentContext, currentLibrary } from "./store.ts";
import type { CompletionData, RankData, SkkServerOptions } from "./types.ts";

type Opts = {
  key: string;
  function?: string;
  expr?: boolean;
};

// deno-lint-ignore no-explicit-any
function assertOpts(x: any): asserts x is Opts {
  if (typeof x?.key !== "string") {
    throw new AssertError("value must be Opts");
  }
}

let initialized = false;

function homeExpand(path: string, homePath: string): string {
  if (path[0] === "~") {
    return homePath + path.slice(1);
  } else {
    return path;
  }
}

async function init(denops: Denops) {
  if (initialized) {
    return;
  }
  if (config.debug) {
    console.log("skkeleton: initialize");
    console.log(config);
  }
  try {
    await denops.cmd("doautocmd <nomodeline> User skkeleton-initialize-pre");
  } catch (e) {
    console.log(e);
  }
  currentContext.get().denops = denops;
  const {
    completionRankFile,
    userJisyo,
    useSkkServer,
    skkServerHost,
    skkServerPort,
    skkServerResEnc,
    skkServerReqEnc,
  } = config;
  let skkServer: SkkServer | undefined;
  let skkServerOptions: SkkServerOptions | undefined;
  if (useSkkServer) {
    skkServerOptions = {
      hostname: skkServerHost,
      port: skkServerPort,
      requestEnc: skkServerReqEnc,
      responseEnc: skkServerResEnc,
    };
    skkServer = new SkkServer(skkServerOptions);
  }
  const homePath = await fn.expand(denops, "~") as string;
  const globalDictionaries =
    (config.globalDictionaries.length === 0
      ? [[config.globalJisyo, config.globalJisyoEncoding]]
      : config.globalDictionaries)
      .map((
        cfg,
      ): [string, string] => {
        if (typeof (cfg) === "string") {
          return [homeExpand(cfg, homePath), ""];
        } else {
          return [homeExpand(cfg[0], homePath), cfg[1]];
        }
      });
  currentLibrary.setInitializer(async () =>
    await jisyoLoad(
      globalDictionaries,
      {
        path: homeExpand(userJisyo, homePath),
        rankPath: homeExpand(completionRankFile, homePath),
      },
      skkServer,
    )
  );
  await receiveNotation(denops);
  autocmd.group(denops, "skkeleton-internal-denops", (helper) => {
    helper.remove("*");
    // Note: 使い終わったステートを初期化する
    //       CmdlineEnterにしてしまうと辞書登録時の呼び出しで壊れる
    helper.define(
      ["InsertLeave", "CmdlineLeave"],
      "*",
      `call denops#request('${denops.name}', 'reset', [])`,
    );
    helper.define(
      ["InsertLeave", "CmdlineLeave"],
      "*",
      `setlocal iminsert=0`,
    );
    helper.define(
      ["InsertLeave", "CmdlineLeave"],
      "*",
      `let g:skkeleton#enabled = v:false`,
    );
  });
  try {
    await denops.cmd("doautocmd <nomodeline> User skkeleton-initialize-post");
  } catch (e) {
    console.log(e);
  }
  initialized = true;
}

async function enable(opts?: unknown, vimStatus?: unknown): Promise<string> {
  const context = currentContext.get();
  const state = context.state;
  const denops = context.denops!;
  if (await fn.mode(denops) === "R") {
    console.log("skkeleton doesn't allowed in replace mode");
    return "";
  }
  if (
    (state.type !== "input" || state.mode !== "direct") && opts && vimStatus
  ) {
    return handle(opts, vimStatus);
  }
  if (await denops.eval("&l:iminsert") !== 1) {
    // Note: must set before context initialization
    currentKanaTable.set(config.kanaTable);

    currentContext.init().denops = denops;
    try {
      await denops.cmd("doautocmd <nomodeline> User skkeleton-enable-pre");
    } catch (e) {
      console.log(e);
    }

    // NOTE: Disable textwidth
    currentContext.get().textwidth = await op.textwidth.getLocal(denops);
    await op.textwidth.setLocal(denops, 0);

    await denops.call("skkeleton#map");
    await op.iminsert.setLocal(denops, 1);
    await vars.b.set(denops, "keymap_name", "skkeleton");
    await vars.g.set(denops, "skkeleton#enabled", true);
    await modeChange(currentContext.get(), "hira");
    try {
      await denops.cmd("doautocmd <nomodeline> User skkeleton-enable-post");
    } catch (e) {
      console.log(e);
    }
    return "\x1e"; // <C-^>
  } else {
    return "";
  }
}

async function disable(opts?: unknown, vimStatus?: unknown): Promise<string> {
  const context = currentContext.get();
  const state = currentContext.get().state;
  if (
    (state.type !== "input" || state.mode !== "direct") && opts && vimStatus
  ) {
    return handle(opts, vimStatus);
  }
  await disableFunc(context);
  return context.preEdit.output(context.toString());
}

function handleCompleteKey(
  completed: boolean,
  completeType: string,
  notation: string,
): string | null {
  if (notation === "<cr>") {
    if (completed && config.eggLikeNewline) {
      switch (completeType) {
        case "native":
          return notationToKey["<c-y>"];
        case "pum.vim":
          return "<Cmd>call pum#map#confirm()";
        case "cmp":
          return "<Cmd>lua require('cmp').confirm({select = true})";
      }
    }
  }
  return null;
}

type CompleteInfo = {
  pum_visible: boolean;
  selected: number;
};

type VimStatus = {
  prevInput: string;
  completeInfo: CompleteInfo;
  completeType: string;
  mode: string;
};

async function handle(
  opts: unknown,
  vimStatus: unknown,
): Promise<string> {
  assertOpts(opts);
  const key = opts.key;
  const { prevInput, completeInfo, completeType, mode } =
    vimStatus as VimStatus;
  const context = currentContext.get();
  context.vimMode = mode;
  if (completeInfo.pum_visible) {
    if (config.debug) {
      console.log("input after complete");
    }
    const notation = keyToNotation[notationToKey[key]];
    if (config.debug) {
      console.log({
        completeType,
        selected: completeInfo.selected,
      });
    }
    const handled = handleCompleteKey(
      completeInfo.selected >= 0,
      completeType,
      notation,
    );
    if (isString(handled)) {
      await initializeStateWithAbbrev(context, ["converter"]);
      context.preEdit.output("");
      return handled;
    }
  }
  // 補完の後などpreEditとバッファが不一致している状態の時にリセットする
  if (!prevInput.endsWith(context.toString())) {
    await initializeStateWithAbbrev(context, ["converter"]);
    context.preEdit.output("");
  }
  const before = context.mode;
  if (opts.function) {
    await functions.get()[opts.function](context, key);
  } else {
    await handleKey(context, key);
  }
  const output = context.preEdit.output(context.toString());
  if (output === "" && before !== context.mode) {
    return " \x08";
  }
  return output;
}

export async function main(denops: Denops) {
  if (await vars.g.get(denops, "skkeleton#debug", false)) {
    config.debug = true;
  }
  denops.dispatcher = {
    config(config: unknown) {
      assertObject(config);
      setConfig(config);
      return Promise.resolve();
    },
    async registerKeyMap(state: unknown, key: unknown, funcName: unknown) {
      assertString(state);
      assertString(key);
      await receiveNotation(denops);
      registerKeyMap(state, key, funcName);
    },
    registerKanaTable(tableName: unknown, table: unknown, create: unknown) {
      assertString(tableName);
      registerKanaTable(tableName, table, !!create);
      return Promise.resolve();
    },
    async enable(opts: unknown, vimStatus: unknown): Promise<string> {
      await init(denops);
      return await enable(opts, vimStatus);
    },
    async disable(opts: unknown, vimStatus: unknown): Promise<string> {
      await init(denops);
      return await disable(opts, vimStatus);
    },
    async toggle(opts: unknown, vimStatus: unknown): Promise<string> {
      await init(denops);
      const mode = await vars.g.get(denops, "skkeleton#mode", "");
      if (await denops.eval("&l:iminsert") !== 1 || mode === "") {
        return await enable(opts, vimStatus);
      } else {
        return await disable(opts, vimStatus);
      }
    },
    handleKey(opts: unknown, vimStatus: unknown): Promise<string> {
      return handle(opts, vimStatus);
    },
    reset() {
      currentContext.init().denops = denops;
      return Promise.resolve();
    },
    //completion
    getPreEditLength(): Promise<number> {
      return Promise.resolve(currentContext.get().toString().length);
    },
    getPreEdit(): Promise<string> {
      return Promise.resolve(currentContext.get().toString());
    },
    getPrefix(): Promise<string> {
      const state = currentContext.get().state;
      if (state.type !== "input") {
        return Promise.resolve("");
      }
      return Promise.resolve(state.henkanFeed);
    },
    async getCandidates(): Promise<CompletionData> {
      const state = currentContext.get().state;
      if (state.type !== "input") {
        return Promise.resolve([]);
      }
      const lib = await currentLibrary.get();
      return lib.getCandidates(state.henkanFeed, state.feed);
    },
    async getRanks(): Promise<RankData> {
      const state = currentContext.get().state;
      if (state.type !== "input") {
        return Promise.resolve([]);
      }
      const lib = await currentLibrary.get();
      return Promise.resolve(lib.getRanks(state.henkanFeed));
    },
    async completeCallback(kana: unknown, word: unknown) {
      assertString(kana);
      assertString(word);
      const lib = await currentLibrary.get();
      await lib.registerCandidate("okurinasi", kana, word);
      const context = currentContext.get();
      context.lastCandidate = {
        type: "okurinasi",
        word: kana,
        candidate: word,
      };
    },
    // deno-lint-ignore require-await
    async getConfig() {
      return config;
    },
  };
  if (config.debug) {
    await denops.cmd(`echomsg "loaded skkeleton"`);
  }
}
