/* eslint-disable no-console -- Don't ship our logger to client, reduce size*/

import * as S from "@effect/schema/Schema";
import { Effect, Layer } from "effect";

import {
  exponentialBackoff,
  fetchContext,
  fetchEffJson,
  RetryError,
  UploadThingError,
} from "@uploadthing/shared";

import { resolveMaybeUrlArg } from "./internal/get-full-api-url";
import { uploadMultipartWithProgress } from "./internal/multi-part";
import { uploadPresignedPostWithProgress } from "./internal/presigned-post";
import { uploadThingResponseSchema } from "./internal/shared-schemas";
import type { UploadThingResponse } from "./internal/shared-schemas";
import type {
  DistributiveOmit,
  FileRouter,
  inferEndpointInput,
  inferEndpointOutput,
} from "./internal/types";
import { createAPIRequestUrl } from "./internal/ut-reporter";

export { resolveMaybeUrlArg };

/*

More Effect refactoring:

- Get rid of `Effect.promise`
  - Either by refactoring promises to be effects (all the way down) with proper error handling
  - Or use `Effect.tryPromise` instead with proper error handling
- 

*/

/**
 * @internal
 * Shared helpers for our premade components that's reusable by multiple frameworks
 */
export * from "./internal/component-theming";

type UploadFilesOptions<
  TRouter extends FileRouter,
  TEndpoint extends keyof TRouter,
> = {
  onUploadProgress?: ({
    file,
    progress,
  }: {
    file: string;
    progress: number;
  }) => void;
  onUploadBegin?: ({ file }: { file: string }) => void;

  files: File[];

  /**
   * URL to the UploadThing API endpoint
   * @example URL { http://localhost:3000/api/uploadthing }
   * @example URL { https://www.example.com/api/uploadthing }
   */
  url: URL;

  /**
   * The uploadthing package that is making this request
   * @example "@uploadthing/react"
   *
   * This is used to identify the client in the server logs
   */
  package: string;
} & (undefined extends inferEndpointInput<TRouter[TEndpoint]>
  ? // eslint-disable-next-line @typescript-eslint/ban-types
    {}
  : {
      input: inferEndpointInput<TRouter[TEndpoint]>;
    });

/**
 * @internal - used to catch errors we've forgotton to wrap in UploadThingError
 * FIXME: Should not be needed after Effect migration
 */
export const INTERNAL_DO_NOT_USE__fatalClientError = (e: Error) =>
  new UploadThingError({
    code: "INTERNAL_CLIENT_ERROR",
    message: "Something went wrong. Please report this to UploadThing.",
    cause: e,
  });

export type UploadFileResponse<TServerOutput> = {
  name: string;
  size: number;
  key: string;
  url: string;
  // Matches what's returned from the serverside `onUploadComplete` callback
  serverData: TServerOutput;
};

export const DANGEROUS__uploadFiles = <
  TRouter extends FileRouter,
  TEndpoint extends keyof TRouter,
>(
  endpoint: TEndpoint,
  opts: UploadFilesOptions<TRouter, TEndpoint>,
) => {
  const uploadFiles = Effect.gen(function* ($) {
    const presigneds = yield* $(
      fetchEffJson(
        createAPIRequestUrl({
          url: opts.url,
          slug: String(endpoint),
          actionType: "upload",
        }),
        uploadThingResponseSchema,
        {
          method: "POST",
          body: JSON.stringify({
            input: "input" in opts ? opts.input : null,
            files: opts.files.map((f) => ({ name: f.name, size: f.size })),
          }),
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    return yield* $(
      Effect.all(
        presigneds.map((presigned) =>
          uploadFile(String(endpoint), opts, presigned),
        ),
      ),
    );
  });

  // TODO: I think this can stay an Effect and not be run as a promise (especially once React package is Effect too)
  //       The `genUploader` can be the one who provides the service and the Promise-inferface for the public
  const layer = Layer.succeed(fetchContext, {
    fetch: globalThis.fetch.bind(globalThis),
    baseHeaders: {},
  });

  return uploadFiles.pipe(
    Effect.catchTag("UTReporterError", (error) => Effect.die(error)),
    Effect.tapErrorCause(Effect.logError),
    Effect.provide(layer),
    Effect.runPromise,
  );
};

export const genUploader = <TRouter extends FileRouter>(initOpts: {
  /**
   * URL to the UploadThing API endpoint
   * @example URL { /api/uploadthing }
   * @example URL { https://www.example.com/api/uploadthing }
   *
   * If relative, host will be inferred from either the `VERCEL_URL` environment variable or `window.location.origin`
   *
   * @default (VERCEL_URL ?? window.location.origin) + "/api/uploadthing"
   */
  url?: string | URL;

  /**
   * The uploadthing package that is making this request
   * @example "@uploadthing/react"
   *
   * This is used to identify the client in the server logs
   */
  package: string;
}) => {
  const url = resolveMaybeUrlArg(initOpts?.url);

  return <TEndpoint extends keyof TRouter>(
    endpoint: TEndpoint,
    opts: DistributiveOmit<
      Parameters<typeof DANGEROUS__uploadFiles<TRouter, TEndpoint>>[1],
      "url" | "package"
    >,
  ) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    DANGEROUS__uploadFiles<TRouter, TEndpoint>(endpoint, {
      ...opts,
      url,
      package: initOpts.package,
    } as any);
};

const uploadFile = <
  TRouter extends FileRouter,
  TEndpoint extends keyof TRouter,
  TServerData = inferEndpointOutput<TRouter[TEndpoint]>,
>(
  slug: string,
  opts: UploadFilesOptions<TRouter, TEndpoint>,
  presigned: UploadThingResponse[number],
) =>
  Effect.gen(function* ($) {
    const file = opts.files.find((f) => f.name === presigned.fileName);

    if (!file) {
      console.error("No file found for presigned URL", presigned);
      return yield* $(
        new UploadThingError({
          code: "NOT_FOUND",
          message: "No file found for presigned URL",
          cause: `Expected file with name ${presigned.fileName} but got '${opts.files.join(",")}'`,
        }),
      );
    }

    opts.onUploadBegin?.({ file: file.name });
    if ("urls" in presigned) {
      yield* $(
        uploadMultipartWithProgress(file, presigned, {
          endpoint: slug,
          ...opts,
        }),
      );
    } else {
      yield* $(uploadPresignedPostWithProgress(file, presigned, { ...opts }));
    }
    // wait a bit as it's unsreasonable to expect the server to be done by now
    // (UT should call user's server, then user's server may do some async work before responding with some data that should be sent back to UT)
    // TODO: We should have an option on the client to opt-out of waiting for server callback  to finish if it doesn't return anything...
    yield* $(Effect.sleep(500));

    const PollingResponse = S.union(
      S.struct({
        status: S.literal("done"),
        callbackData: S.any as S.Schema<TServerData, any>,
      }),
      S.struct({ status: S.literal("still waiting") }),
    );

    const serverData = yield* $(
      fetchEffJson(presigned.pollingUrl, PollingResponse, {
        headers: { authorization: presigned.pollingJwt },
      }),
      Effect.andThen((res) =>
        res.status === "done"
          ? Effect.succeed(res.callbackData)
          : Effect.fail(new RetryError()),
      ),
      Effect.retry({
        while: (res) => res instanceof RetryError,
        schedule: exponentialBackoff,
      }),
    );

    return {
      name: file.name,
      size: file.size,
      key: presigned.key,
      serverData,
      url: "https://utfs.io/f/" + presigned.key,
    } satisfies UploadFileResponse<TServerData>;
  });
