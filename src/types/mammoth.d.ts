// Minimal type shim untuk mammoth (CJS, tanpa types resmi & @types/mammoth gak ada di registry)
declare module "mammoth" {
  interface MammothInput {
    buffer?: Buffer | ArrayBuffer | Uint8Array;
    path?: string;
  }

  interface MammothResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  interface MammothApi {
    extractRawText(input: MammothInput): Promise<MammothResult>;
    convertToHtml(input: MammothInput): Promise<{ value: string }>;
  }

  const mammoth: MammothApi;
  export default mammoth;
}
