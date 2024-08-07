import { config } from "./config.ts";
import { distinctBy } from "./deps/std/collections.ts";
import { is, u } from "./deps/unknownutil.ts";
import { functions, functionsWithArgs } from "./function.ts";
import { romToHira } from "./kana/rom_hira.ts";
import { romToZen } from "./kana/rom_zen.ts";
import type { KanaResult, KanaTable } from "./kana/type.ts";
import { Cell, readFileWithEncoding } from "./util.ts";

type PartialKanaTable = [string, KanaResult | null][];

const tables: Cell<Record<string, KanaTable>> = new Cell(() => ({
  rom: romToHira,
  zen: romToZen,
}));

export const currentKanaTable = new Cell(() => "rom");

export function getKanaTable(name = currentKanaTable.get()): KanaTable {
  const table = tables.get()[name];
  if (!table) {
    throw new Error(`undefined table: ${name}`);
  }
  return table;
}

function asKanaResult(result: unknown): KanaResult | null {
  if (is.String(result)) {
    const [funcName, args] = String(result).split("-");
    const fn = args
      ? functionsWithArgs.get()[funcName]?.(args)
      : functions.get()[funcName];
    if (!fn) {
      throw Error(`function not found: ${result}`);
    }
    return fn;
  } else if (
    Array.isArray(result) &&
    result.length >= 1 &&
    result.every(is.String)
  ) {
    return [result[0], result[1] ?? ""] as KanaResult;
  } else if (!result) {
    return null;
  }
  throw Error(`Illegal result: ${result}`);
}

export function registerKanaTable(
  name: string,
  rawTable: unknown,
  create = false
) {
  if (config.debug) {
    console.log("skkeleton: new kana table");
    console.log(`name: ${name}, table: ${Deno.inspect(rawTable)}`);
  }
  u.assert(rawTable, is.Record);
  const table: PartialKanaTable = Object.entries(rawTable)
    .map(([kana, result]) => {
      return [kana, asKanaResult(result)];
    });
  injectKanaTable(name, table, create);
}

export async function loadKanaTableFiles(
  payload: (string | [string, string])[]): Promise<void> {
  const table: KanaTable = [];

  const tasks = payload.map(async (v) => {
    const [path, encodingName] = Array.isArray(v) ? v : [v, undefined];
    const file = await readFileWithEncoding(path, encodingName);
    const lines = file.split("\n");
    for (const line of lines) {
      if (line.startsWith("#")) {
        continue;
      }
      if (line.trim() === "") {
        continue;
      }
      const [from, result] = line.split(",");
      table.push([from, [result, ""]]);
    }
  });

  await Promise.all(tasks);
  injectKanaTable("rom", table);
}

/*
 * Concat given kanaTable to the table named `name`.
 * When the table is not found, create if create=true; otherwise throws `table ${name} is not found`.
 */
function injectKanaTable(
  name: string,
  table: PartialKanaTable,
  create = false,
) {
  const t = tables.get();
  if (!t[name] && !create) {
    throw Error(`table ${name} is not found.`);
  }
  t[name] = distinctBy([...table, ...t[name] ?? []], (it) => it[0])
    .filter((e): e is [string, KanaResult] => e[1] != null)
    .sort((a, b) => a[0].localeCompare(b[0]));
}
