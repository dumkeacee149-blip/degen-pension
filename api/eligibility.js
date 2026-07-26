import { decideEligibility } from "../server/eligibility.js";
import { createApiHandler } from "../server/http.js";
import { requireAddress, requireObject } from "../server/validation.js";

export default createApiHandler(
  {
    name: "eligibility",
    methods: ["POST"],
    rateLimit: 20,
    body: true,
  },
  async ({ body, config, country }) => {
    const input = requireObject(body);
    const wallet = requireAddress(input.wallet, "wallet");
    const decision = await decideEligibility(config, {
      wallet,
      countryCode: country,
      termsAccepted: input.termsAccepted,
      notUSPerson: input.notUSPerson,
    });
    return {
      status: decision.eligible ? 200 : 403,
      body: decision,
    };
  },
);
