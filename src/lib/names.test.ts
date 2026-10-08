import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { localSigner } from "./signer";
import { isFederationAddress, nameMessage, resolveRecipient } from "./names";

// SEP-53 spec test vector — the same one flexi-pay/backend verifies against.
const SEED = "SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW";
const SIG = "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==";

describe("FlexiPay names", () => {
  it("built-in wallet signs messages exactly like SEP-53 wallets", async () => {
    expect(await localSigner(SEED).signMessage("Hello, World!")).toBe(SIG);
  });
  it("builds the message format the backend expects", () => {
    expect(nameMessage("register", "nuel", "GABC", 5)).toBe("flexipay:register:nuel:GABC:5");
  });
  it("recognises federation addresses", () => {
    expect(isFederationAddress("nuel*flexipay.app")).toBe(true);
    expect(isFederationAddress("first.last@mail.com*lobstr.co")).toBe(true);
    expect(isFederationAddress("nuel")).toBe(false);
    expect(isFederationAddress("nuel*nodot")).toBe(false);
  });
  it("passes G… addresses straight through and rejects junk", async () => {
    const pk = Keypair.random().publicKey();
    expect(await resolveRecipient(` ${pk} `)).toEqual({ accountId: pk });
    await expect(resolveRecipient("hello")).rejects.toThrow(/G… address or a name/);
  });
});
