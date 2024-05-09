import type * as Effect from "effect/Effect";

import type {
  ErrorMessage,
  FetchContext,
  FetchEsque,
  FileRouterInputConfig,
  FileRouterInputKey,
  Json,
  MaybePromise,
  Simplify,
  UploadThingError,
} from "@uploadthing/shared";

import type { FileUploadDataWithCustomId, UploadedFileData } from "../types";
import type { LogLevel } from "./logger";
import type { JsonParser } from "./parser";

/**
 * Returned by `/api/prepareUpload` and `/api/uploadFiles`
 */
export type PresignedBase = {
    readonly key: string;
    readonly fileName: string;
    readonly fileUrl: string;
    readonly pollingJwt: string;
    readonly pollingUrl: string;
    readonly contentDisposition: "inline" | "attachment";
    readonly customId: string | null;
    readonly fileType: FileRouterInputKey;
};
export type PSPResponse = {
    readonly key: string;
    readonly fileName: string;
    readonly fileUrl: string;
    readonly pollingJwt: string;
    readonly pollingUrl: string;
    readonly contentDisposition: "inline" | "attachment";
    readonly customId: string | null;
    readonly fileType: FileRouterInputKey;
    readonly url: string;
    readonly fields: {
        readonly [x: string]: string;
    };
};
export type MPUResponse = {
    readonly key: string;
    readonly fileName: string;
    readonly fileUrl: string;
    readonly pollingJwt: string;
    readonly pollingUrl: string;
    readonly contentDisposition: "inline" | "attachment";
    readonly customId: string | null;
    readonly fileType: FileRouterInputKey;
    readonly urls: readonly string[];
    readonly uploadId: string;
    readonly chunkSize: number;
    readonly chunkCount: number;
};
export type PresignedURLs = readonly ({
    readonly key: string;
    readonly fileName: string;
    readonly fileUrl: string;
    readonly pollingJwt: string;
    readonly pollingUrl: string;
    readonly contentDisposition: "inline" | "attachment";
    readonly customId: string | null;
    readonly fileType: FileRouterInputKey;
    readonly url: string;
    readonly fields: {
        readonly [x: string]: string;
    };
} | {
    readonly key: string;
    readonly fileName: string;
    readonly fileUrl: string;
    readonly pollingJwt: string;
    readonly pollingUrl: string;
    readonly contentDisposition: "inline" | "attachment";
    readonly customId: string | null;
    readonly fileType: FileRouterInputKey;
    readonly urls: readonly string[];
    readonly uploadId: string;
    readonly chunkSize: number;
    readonly chunkCount: number;
})[];

/**
 * Marker used to append a `customId` to the incoming file data in `.middleware()`
 * @example
 * ```ts
 * .middleware((opts) => {
 *   return {
 *     [UTFiles]: opts.files.map((file) => ({
 *       ...file,
 *       customId: generateId(),
 *     }))
 *   };
 * })
 * ```
 */
export const UTFiles = Symbol("uploadthing-custom-id-symbol");

const unsetMarker = "unsetMarker" as "unsetMarker" & {
  __brand: "unsetMarker";
};
export type UnsetMarker = typeof unsetMarker;

export type ValidMiddlewareObject = {
  [UTFiles]?: Partial<FileUploadDataWithCustomId>[];
  [key: string]: unknown;
};

type ResolverOptions<TParams extends AnyParams> = {
  metadata: Simplify<
    TParams["_metadata"] extends UnsetMarker
      ? undefined
      : Omit<TParams["_metadata"], typeof UTFiles>
  >;

  file: UploadedFileData;
};

/**
 * Different frameworks have different request and response types
 */
export type MiddlewareFnArgs<TRequest, TResponse, TEvent> = {
  req: TRequest;
  res: TResponse;
  event: TEvent;
};

export interface AnyParams {
  _input: any;
  _metadata: any; // imaginary field used to bind metadata return type to an Upload resolver
  _middlewareArgs: MiddlewareFnArgs<any, any, any>;
  _errorShape: any;
  _errorFn: any; // used for onUploadError
  _output: any;
}

type MiddlewareFn<
  TInput extends Json | UnsetMarker,
  TOutput extends ValidMiddlewareObject,
  TArgs extends MiddlewareFnArgs<any, any, any>,
> = (
  opts: TArgs & {
    files: readonly {
    readonly name: string;
    readonly size: number;
    readonly type: string;
}[];
    input: TInput extends UnsetMarker ? undefined : TInput;
  },
) => MaybePromise<TOutput>;

type ResolverFn<TOutput extends Json | void, TParams extends AnyParams> = (
  opts: ResolverOptions<TParams>,
) => MaybePromise<TOutput>;

type UploadErrorFn = (input: {
  error: UploadThingError;
  fileKey: string;
}) => void;

export interface UploadBuilder<TParams extends AnyParams> {
  input: <TParser extends JsonParser>(
    parser: TParams["_input"] extends UnsetMarker
      ? TParser
      : ErrorMessage<"input is already set">,
  ) => UploadBuilder<{
    _input: TParser["_output"];
    _metadata: TParams["_metadata"];
    _middlewareArgs: TParams["_middlewareArgs"];
    _errorShape: TParams["_errorShape"];
    _errorFn: TParams["_errorFn"];
    _output: UnsetMarker;
  }>;
  middleware: <TOutput extends ValidMiddlewareObject>(
    fn: TParams["_metadata"] extends UnsetMarker
      ? MiddlewareFn<TParams["_input"], TOutput, TParams["_middlewareArgs"]>
      : ErrorMessage<"middleware is already set">,
  ) => UploadBuilder<{
    _input: TParams["_input"];
    _metadata: TOutput;
    _middlewareArgs: TParams["_middlewareArgs"];
    _errorShape: TParams["_errorShape"];
    _errorFn: TParams["_errorFn"];
    _output: UnsetMarker;
  }>;
  onUploadComplete: <TOutput extends Json | void>(
    fn: ResolverFn<TOutput, TParams>,
  ) => Uploader<{
    _input: TParams["_input"];
    _metadata: TParams["_metadata"];
    _middlewareArgs: TParams["_middlewareArgs"];
    _errorShape: TParams["_errorShape"];
    _errorFn: TParams["_errorFn"];
    _output: TOutput;
  }>;
  onUploadError: (
    fn: TParams["_errorFn"] extends UnsetMarker
      ? UploadErrorFn
      : ErrorMessage<"onUploadError is already set">,
  ) => UploadBuilder<{
    _input: TParams["_input"];
    _metadata: TParams["_metadata"];
    _middlewareArgs: TParams["_middlewareArgs"];
    _errorShape: TParams["_errorShape"];
    _errorFn: UploadErrorFn;
    _output: UnsetMarker;
  }>;
}

export type UploadBuilderDef<TParams extends AnyParams> = {
  routerConfig: FileRouterInputConfig;
  inputParser: JsonParser;
  // eslint-disable-next-line @typescript-eslint/ban-types
  middleware: MiddlewareFn<TParams["_input"], {}, TParams["_middlewareArgs"]>;
  errorFormatter: (err: UploadThingError) => TParams["_errorShape"];
  onUploadError: UploadErrorFn;
};

export interface Uploader<TParams extends AnyParams> {
  _def: TParams & UploadBuilderDef<TParams>;
  resolver: ResolverFn<TParams["_output"], TParams>;
}
export type AnyUploader = Uploader<AnyParams>;

export type FileRouter<TParams extends AnyParams = AnyParams> = Record<
  string,
  Uploader<TParams>
>;

export type RouteHandlerConfig = {
  logLevel?: LogLevel;
  callbackUrl?: string;
  uploadthingId?: string;
  uploadthingSecret?: string;
  /**
   * Used to determine whether to run dev hook or not
   * @default `env.NODE_ENV === "development" || env.NODE_ENV === "dev"`
   */
  isDev?: boolean;
  /**
   * Used to override the fetch implementation
   * @default `globalThis.fetch`
   */
  fetch?: FetchEsque;
};

export type RouteHandlerOptions<TRouter extends FileRouter> = {
  router: TRouter;
  config?: RouteHandlerConfig;
};

export type RequestHandlerInput<TArgs extends MiddlewareFnArgs<any, any, any>> =
  {
    req: Request | Effect.Effect<Request, UploadThingError>;
    middlewareArgs: TArgs;
  };
export type RequestHandlerSuccess = {
  success: true;
  body: UTEvents[keyof UTEvents]["out"];
  cleanup?: Promise<unknown> | undefined;
};
export type RequestHandlerError = {
  success: false;
  error: UploadThingError;
};
export type RequestHandlerOutput = RequestHandlerSuccess | RequestHandlerError;

export type RequestHandler<TArgs extends MiddlewareFnArgs<any, any, any>> = (
  input: RequestHandlerInput<TArgs>,
) => Effect.Effect<RequestHandlerSuccess, UploadThingError, FetchContext>;

export type inferEndpointInput<TUploader extends Uploader<any>> =
  TUploader["_def"]["_input"] extends UnsetMarker
    ? undefined
    : TUploader["_def"]["_input"];

export type inferEndpointOutput<TUploader extends AnyUploader> =
  TUploader["_def"]["_output"] extends UnsetMarker | void | undefined
    ? null
    : TUploader["_def"]["_output"];

export type inferErrorShape<TRouter extends FileRouter> =
  TRouter[keyof TRouter]["_def"]["_errorShape"];

/**
 * Valid options for the `?actionType` query param
 */
export const VALID_ACTION_TYPES = [
  "upload",
  "failure",
  "multipart-complete",
] as const;
export type ActionType = (typeof VALID_ACTION_TYPES)[number];
export const isActionType = (input: unknown): input is ActionType =>
  typeof input === "string" && VALID_ACTION_TYPES.includes(input as ActionType);

/**
 * Valid options for the `uploadthing-hook` header
 * for requests coming from UT server
 */
export const VALID_UT_HOOKS = ["callback"] as const;
export type UploadThingHook = (typeof VALID_UT_HOOKS)[number];
export const isUploadThingHook = (input: unknown): input is UploadThingHook =>
  typeof input === "string" &&
  VALID_UT_HOOKS.includes(input as UploadThingHook);

/**
 * Map actionType to the required payload for that action
 * @todo Look into using @effect/rpc :thinking:
 */
export type UTEvents = {
  upload: {
    in: {
    readonly files: readonly {
        readonly name: string;
        readonly size: number;
        readonly type: string;
    }[];
    readonly input: Json;
};
    out: readonly ({
    readonly key: string;
    readonly customId: string | null;
    readonly fileName: string;
    readonly fileUrl: string;
    readonly pollingJwt: string;
    readonly pollingUrl: string;
    readonly contentDisposition: "inline" | "attachment";
    readonly fileType: FileRouterInputKey;
    readonly url: string;
    readonly fields: {
        readonly [x: string]: string;
    };
} | {
    readonly key: string;
    readonly customId: string | null;
    readonly fileName: string;
    readonly fileUrl: string;
    readonly pollingJwt: string;
    readonly pollingUrl: string;
    readonly contentDisposition: "inline" | "attachment";
    readonly fileType: FileRouterInputKey;
    readonly urls: readonly string[];
    readonly uploadId: string;
    readonly chunkSize: number;
    readonly chunkCount: number;
})[];
  };
  failure: {
    in: {
    readonly fileKey: string;
    readonly uploadId: string | null;
    readonly storageProviderError?: string | undefined;
    readonly fileName: string;
};
    out: null;
  };
  "multipart-complete": {
    in: {
    readonly fileKey: string;
    readonly uploadId: string;
    readonly etags: readonly {
        readonly tag: string;
        readonly partNumber: number;
    }[];
};
    out: null;
  };
};
