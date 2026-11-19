import type { Instrumentation } from "next";

// Every server error becomes one JSON line in the container log (`docker logs hardcode-ops-app`), with the page's
// reference (digest) that people see on the error screen. The query string is dropped: it can hold sign-in codes.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const message = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      message,
      digest,
      method: request.method,
      path: request.path.split("?")[0],
      route: context.routePath,
      kind: context.routeType,
    }),
  );
};
