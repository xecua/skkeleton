import { config } from "../config.ts";
import type { Context } from "../context.ts";
import { autocmd, op } from "../deps.ts";
import { initializeState } from "../state.ts";
import { kakutei } from "./common.ts";

export async function disable(context: Context) {
  const denops = context.denops!;
  await op.textwidth.setLocal(denops, context.textwidth);
  await kakutei(context);
  await denops.call("skkeleton#disable");
  initializeState(context.state);
}

export async function escape(context: Context) {
  const denops = context.denops!;
  if (config.keepState) {
    autocmd.group(denops, "skkeleton", (helper) => {
      helper.define(
        "InsertEnter",
        "<buffer>",
        `call skkeleton#handle('enable', {})`,
        { once: true },
      );
    });
  }
  await disable(context);
  context.state.type = "escape";
}
