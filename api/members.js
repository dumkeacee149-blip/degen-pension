import { getAddress, isAddress } from "viem";
import { ApiError, createApiHandler } from "../server/http.js";
import { loadMemberCount } from "../server/stats.js";

function recipientFromRequest(req) {
  const queryValue = req.query?.recipient;
  const values = Array.isArray(queryValue) ? queryValue : [queryValue];
  const url = new URL(req.url || "/", "https://degen-pension.invalid");
  const urlValues = url.searchParams.getAll("recipient");
  if (values.length > 1 || urlValues.length > 1) {
    throw new ApiError(400, "INVALID_RECIPIENT", "Provide at most one recipient.");
  }
  const recipient = values[0] ?? urlValues[0];

  if (recipient === undefined) return undefined;
  if (typeof recipient !== "string" || !isAddress(recipient.trim())) {
    throw new ApiError(400, "INVALID_RECIPIENT", "Recipient must be a valid EVM address.");
  }
  return getAddress(recipient.trim());
}

export default createApiHandler(
  {
    name: "members",
    methods: ["GET"],
    rateLimit: 60,
    cacheControl: "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  },
  async ({ config, req }) => ({
    status: 200,
    body: await loadMemberCount(config, { recipient: recipientFromRequest(req) }),
  }),
);
