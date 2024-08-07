export type CompletionData = [string, string[]][];
export type RankData = [string, number][];

export type CompletionMetadata = {
  tag: "skkeleton";
  kana: string;
};

export const Encode = {
  "utf-32": "UTF32",
  "utf-16": "UTF16",
  "utf-16be": "UTF16BE",
  "utf-16le": "UTF16LE",
  "binary": "BINARY",
  "ascii": "ASCII",
  "jis": "JIS",
  "utf-8": "UTF8",
  "euc-jp": "EUCJP",
  "sjis": "SJIS",
  "unicode": "UNICODE",
  "auto": "AUTO",
} as const;

export type Encoding = keyof typeof Encode;

export type SkkServerOptions = {
  requestEnc: Encoding;
  responseEnc: Encoding;
} & Deno.ConnectOptions;

export type ConfigOptions = {
  acceptIllegalResult: boolean;
  completionRankFile: string;
  databasePath: string;
  debug: boolean;
  eggLikeNewline: boolean;
  globalDictionaries: (string | [string, string])[];
  globalKanaTableFiles: (string | [string, string])[];
  immediatelyCancel: boolean;
  immediatelyDictionaryRW: boolean;
  immediatelyOkuriConvert: boolean;
  kanaTable: string;
  keepMode: boolean;
  keepState: boolean;
  markerHenkan: string;
  markerHenkanSelect: string;
  registerConvertResult: boolean;
  selectCandidateKeys: string;
  setUndoPoint: boolean;
  showCandidatesCount: number;
  skkServerHost: string;
  skkServerPort: number;
  skkServerReqEnc: Encoding;
  skkServerResEnc: Encoding;
  sources: string[];
  useGoogleJapaneseInput?: never;
  usePopup: boolean;
  useSkkServer?: never;
  userDictionary: string;
};
