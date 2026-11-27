import { verifyAccessJwt } from "./access";
import { handleRequest, todayInJapan } from "./app";
import { runArchiveIndexing } from "./archive";
import { viewerServiceNames } from "./content";
import type { NookEnv } from "./env";

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, {
      fetch: (input, init) => fetch(input, init),
      verifyAccess: verifyAccessJwt,
      now: () => new Date(),
      background: (promise) => ctx.waitUntil(promise),
    });
  },
  // 毎朝の収集(06:17 JST 開始)のあとに、アーカイブの索引を入れる(#15)
  async scheduled(_controller, env, ctx) {
    const now = new Date();
    ctx.waitUntil(
      runArchiveIndexing({
        db: env.DB,
        bucket: env.NOOK_BUCKET,
        appNames: viewerServiceNames(env),
        today: todayInJapan(now),
        now,
      }),
    );
  },
} satisfies ExportedHandler<NookEnv>;
