import { createApiHandler } from "../server/http.js";
import { loadHolderStockProof } from "../server/stats.js";

export default createApiHandler(
  {
    name: "holder-stock",
    methods: ["GET"],
    rateLimit: 30,
    cacheControl: "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  },
  async ({ config }) => ({
    status: 200,
    body: await loadHolderStockProof(config),
  }),
);
