import { encoding } from "../deps/encoding_japanese.ts";
import { Encode } from "../types.ts";
import { getKanaTable } from "../kana.ts";
import { TextLineStream } from "../deps/std/streams.ts";
import { Dictionary, HenkanType } from "../jisyo.ts";
import type { CompletionData, Encoding, SkkServerOptions } from "../types.ts";

export class SkkServer implements Dictionary {
  #conn: Deno.Conn | undefined;
  responseEncoding: Encoding;
  requestEncoding: Encoding;
  connectOptions: Deno.ConnectOptions;
  constructor(opts: SkkServerOptions) {
    this.requestEncoding = opts.requestEnc;
    this.responseEncoding = opts.responseEnc;
    this.connectOptions = {
      hostname: opts.hostname,
      port: opts.port,
    };
  }
  async connect() {
    this.#conn = await Deno.connect(this.connectOptions);
  }
  async getHenkanResult(_type: HenkanType, word: string): Promise<string[]> {
    if (!this.#conn) return [];

    await this.#conn.write(encode(`1${word} `, this.requestEncoding));
    const result: string[] = [];
    for await (
      const str of iterLine(this.#conn.readable, this.responseEncoding)
    ) {
      result.push(...(str.at(0) === "4") ? [] : str.split("/").slice(1, -1));

      if (str.endsWith("\n")) {
        break;
      }
    }
    return result;
  }
  async getCompletionResult(
    prefix: string,
    feed: string,
  ): Promise<CompletionData> {
    if (!this.#conn) return [];

    let midashis: string[] = [];
    if (feed != "") {
      const table = getKanaTable();
      for (const [key, kanas] of table) {
        if (key.startsWith(feed) && kanas.length > 1) {
          const feedPrefix = prefix + (kanas as string[])[0];
          midashis = midashis.concat(await this.getMidashis(feedPrefix));
        }
      }
    } else {
      midashis = await this.getMidashis(prefix);
    }

    const candidates: CompletionData = [];
    for (const midashi of midashis) {
      candidates.push([
        midashi,
        await this.getHenkanResult("okurinasi", midashi),
      ]);
    }

    return candidates;
  }
  private async getMidashis(prefix: string): Promise<string[]> {
    // Get midashis from prefix
    if (!this.#conn) return [];

    await this.#conn.write(encode(`4${prefix} `, this.requestEncoding));
    const midashis: string[] = [];
    for await (
      const str of iterLine(this.#conn.readable, this.responseEncoding)
    ) {
      midashis.push(...(str.at(0) === "4") ? [] : str.split("/").slice(1, -1));

      if (str.endsWith("\n")) {
        break;
      }
    }

    return midashis;
  }
  close() {
    this.#conn?.write(encode("0", this.requestEncoding));
    this.#conn?.close();
  }
}

async function* iterLine(
  r: ReadableStream<Uint8Array>,
  encoding: string,
): AsyncIterable<string> {
  const lines = r
    .pipeThrough(new TextDecoderStream(encoding), {
      preventAbort: true,
      preventCancel: true,
      preventClose: true,
    })
    .pipeThrough(new TextLineStream());

  for await (const line of lines) {
    if ((line as string).length) {
      yield line as string;
    }
  }
}

function encode(str: string, encode: Encoding): Uint8Array {
  const utf8Encoder = new TextEncoder();
  const utf8Bytes = utf8Encoder.encode(str);
  const eucBytesArray = encoding.convert(utf8Bytes, Encode[encode], "UTF8");
  const eucBytes = Uint8Array.from(eucBytesArray);
  return eucBytes;
}
