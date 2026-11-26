import { verifyAccessJwt } from "./access";
import { handleRequest } from "./app";
import type { NookEnv } from "./env";

export default {
  fetch(request, env) {
    return handleRequest(request, env, {
      fetch: (input, init) => fetch(input, init),
      verifyAccess: verifyAccessJwt,
      now: () => new Date(),
    });
  },
} satisfies ExportedHandler<NookEnv>;
