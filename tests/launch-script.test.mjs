import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROL_WALLET,
  createLocalControlServer,
  ELIGIBILITY_POLICY_HASH,
  vercelRuntimeValues,
} from "../scripts/launch-production.mjs";
import * as publicDeployment from "../src/productionDeployment.js";

const { explorerAddress, PRODUCTION_DEPLOYMENT } = publicDeployment;

test("public production record pins the verified foundation and inactive market", () => {
  assert.equal(PRODUCTION_DEPLOYMENT.marketFactoryAddress, "0xeE5b5Cc20264Eb76C0F462efCabc823cA65E76c9");
  assert.equal(PRODUCTION_DEPLOYMENT.gatewayImplementationAddress, "0xAC5A2Cf5e3ab76f9d5EC7A2Ac5983732E5211919");
  assert.equal(PRODUCTION_DEPLOYMENT.projectAuthority, CONTROL_WALLET);
  assert.equal(PRODUCTION_DEPLOYMENT.factorySourceVerified, true);
  assert.equal(PRODUCTION_DEPLOYMENT.gatewayImplementationSourceVerified, true);
  assert.equal(PRODUCTION_DEPLOYMENT.gatewayImplementationLocked, true);
  assert.equal(PRODUCTION_DEPLOYMENT.marketActive, false);
  assert.equal(PRODUCTION_DEPLOYMENT.officialTokenAddress, "");
  assert.equal(PRODUCTION_DEPLOYMENT.activeMarketAddress, "");
  assert.equal(
    explorerAddress(PRODUCTION_DEPLOYMENT.marketFactoryAddress),
    `https://robinhoodchain.blockscout.com/address/${PRODUCTION_DEPLOYMENT.marketFactoryAddress}`,
  );
});

test("public production module exposes no transaction or wallet controls", () => {
  assert.deepEqual(
    Object.keys(publicDeployment).sort(),
    ["PRODUCTION_DEPLOYMENT", "explorerAddress"],
  );
});

test("Vercel synchronization exposes only runtime verification bindings", () => {
  const values = vercelRuntimeValues({
    registryAddress: "0x1111111111111111111111111111111111111111",
    implementationAddress: "0x2222222222222222222222222222222222222222",
    implementationCodeHash: `0x${"33".repeat(32)}`,
    eligibilityCheckerAddress: "0x4444444444444444444444444444444444444444",
    eligibilityPolicyHash: ELIGIBILITY_POLICY_HASH,
  });
  assert.deepEqual(Object.keys(values), [
    "REGISTRY_ADDRESS",
    "PROJECT_AUTHORITY_ADDRESS",
    "GATEWAY_IMPLEMENTATION_ADDRESS",
    "GATEWAY_IMPLEMENTATION_CODE_HASH",
    "ELIGIBILITY_CHECKER_ADDRESS",
    "ELIGIBILITY_POLICY_HASH",
  ]);
  assert.equal(values.PROJECT_AUTHORITY_ADDRESS, CONTROL_WALLET);
  assert.equal("DEPLOYER_ADDRESS" in values, false);
  assert.equal("PRIVATE_KEY" in values, false);
});

test("private loopback callback accepts only the token-bound local admin origin", async () => {
  const token = "ab".repeat(24);
  const control = createLocalControlServer(token);
  await control.listen();
  try {
    const waiting = control.waitFor("registry", 2_000);
    const response = await fetch(`http://127.0.0.1:4178/state?token=${token}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:4177",
      },
      body: JSON.stringify({
        event: "registry",
        payload: { registryAddress: "0x1111111111111111111111111111111111111111" },
      }),
    });
    assert.equal(response.status, 204);
    assert.deepEqual(await waiting, {
      registryAddress: "0x1111111111111111111111111111111111111111",
    });

    const rejected = await fetch(`http://127.0.0.1:4178/state?token=${token}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
      },
      body: JSON.stringify({ event: "authorized", payload: {} }),
    });
    assert.equal(rejected.status, 403);
  } finally {
    await control.close();
  }
});
