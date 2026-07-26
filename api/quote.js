import { createApiHandler } from "../server/http.js";
import { createQuote } from "../server/quote.js";
import {
  requireAddress,
  requireAmountInWei,
  requireObject,
  requireSlippageBps,
} from "../server/validation.js";

export default createApiHandler(
  {
    name: "quote",
    methods: ["POST"],
    rateLimit: 15,
    body: true,
  },
  async ({ body, config, country }) => {
    const input = requireObject(body);
    const wallet = requireAddress(input.wallet, "wallet");
    const recipient = requireAddress(input.recipient, "recipient");
    const amountInWei = requireAmountInWei(input.amountInWei, config);
    const slippageBps = requireSlippageBps(input.slippageBps, config);
    const quote = await createQuote(config, {
      wallet,
      recipient,
      amountInWei,
      slippageBps,
      termsAccepted: input.termsAccepted,
      notUSPerson: input.notUSPerson,
      countryCode: country,
    });
    return { status: 200, body: quote };
  },
);
