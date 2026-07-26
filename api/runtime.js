import { createApiHandler } from "../server/http.js";
import { loadRuntime } from "../server/runtime.js";

export default createApiHandler(
  {
    name: "runtime",
    methods: ["GET"],
    rateLimit: 60,
    cacheControl: "public, max-age=0, s-maxage=10, stale-while-revalidate=20",
    runtimeSurface: true,
  },
  async ({ config }) => ({
    status: 200,
    body: await loadRuntime(config),
  }),
);
