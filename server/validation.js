import { getAddress, isAddress, parseEther } from "viem";
import { ApiError } from "./http.js";
import { ROBINHOOD_CHAIN_ID } from "./constants.js";

export function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_BODY", "Request body must be a JSON object.");
  }
  return value;
}

export function requireAddress(value, field) {
  const normalized = String(value || "").trim();
  if (!isAddress(normalized)) {
    throw new ApiError(400, "INVALID_ADDRESS", `${field} must be a valid EVM address.`);
  }
  return getAddress(normalized);
}

export function requireChainId(value) {
  const parsed = Number(value);
  if (parsed !== ROBINHOOD_CHAIN_ID) {
    throw new ApiError(400, "WRONG_CHAIN", `chainId must be ${ROBINHOOD_CHAIN_ID}.`);
  }
  return parsed;
}

export function requireAmountWei(value, config) {
  const amount = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amount)) {
    throw new ApiError(400, "INVALID_AMOUNT", "amountEth must be a positive decimal with at most 18 decimals.");
  }
  let wei;
  try {
    wei = parseEther(amount);
  } catch {
    throw new ApiError(400, "INVALID_AMOUNT", "amountEth cannot be converted to wei.");
  }
  if (wei < config.minimumBuyWei || wei > config.maximumBuyWei) {
    throw new ApiError(400, "AMOUNT_OUT_OF_RANGE", "amountEth is outside the configured order limits.");
  }
  return wei;
}

export function requireAmountInWei(value, config) {
  const amount = String(value ?? "").trim();
  if (!/^[1-9]\d{0,77}$/.test(amount)) {
    throw new ApiError(400, "INVALID_AMOUNT", "amountInWei must be a positive base-10 integer.");
  }
  let wei;
  try {
    wei = BigInt(amount);
  } catch {
    throw new ApiError(400, "INVALID_AMOUNT", "amountInWei cannot be parsed.");
  }
  if (wei < config.minimumBuyWei || wei > config.maximumBuyWei) {
    throw new ApiError(400, "AMOUNT_OUT_OF_RANGE", "amountInWei is outside the configured order limits.");
  }
  return wei;
}

export function requireSlippageBps(value, config) {
  if (value === undefined || value === null || value === "") return config.defaultSlippageBps;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > config.maximumSlippageBps) {
    throw new ApiError(
      400,
      "INVALID_SLIPPAGE",
      `slippageBps must be an integer from 1 to ${config.maximumSlippageBps}.`,
    );
  }
  return parsed;
}

export function requireToken(value, field = "eligibilityToken") {
  const token = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 4_096) {
    throw new ApiError(400, "INVALID_TOKEN", `${field} is malformed.`);
  }
  return token;
}
