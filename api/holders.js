import { createApiHandler } from "../server/http.js";
import { loadHolderCount } from "../server/stats.js";

export default createApiHandler(
  {
    name: "holders",
    methods: ["GET"],
    rateLimit: 60,
    cacheControl: "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  },
  async ({ config }) => ({
    status: 200,
    body: await loadHolderCount(config),
  }),
);
