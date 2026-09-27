import {
  Client,
  PrivateKey,
  AccountId,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
} from "@hashgraph/sdk";
import { env } from "../config/env.js";

/** One-off: creates the TEC (Tunisian Energy Coin) fungible token on Hedera
 * testnet. Run with `npm run init:token` only after setting HEDERA_OPERATOR_ID
 * and HEDERA_OPERATOR_KEY in .env (a real testnet account from
 * portal.hedera.com). Prints the resulting token id — put it in
 * HEDERA_TOKEN_ID to switch the app into real Hedera mode. */

async function main() {
  if (!env.hederaOperatorId || !env.hederaOperatorKey) {
    console.error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set in .env (see .env.example).");
    process.exit(1);
  }

  const operatorId = AccountId.fromString(env.hederaOperatorId);
  const operatorKey = PrivateKey.fromStringECDSA(env.hederaOperatorKey);
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);

  try {
    const tx = await new TokenCreateTransaction()
      .setTokenName("Tunisian Energy Coin")
      .setTokenSymbol("TEC")
      .setTokenType(TokenType.FungibleCommon)
      // 6 decimals: on-chain smallest units == the app's µTEC (domain/units.ts).
      .setDecimals(6)
      .setInitialSupply(0) // all TEC is issued by the app (GRANT/MINT), then anchored
      .setTreasuryAccountId(operatorId)
      .setSupplyType(TokenSupplyType.Infinite)
      .setSupplyKey(operatorKey)
      .setAdminKey(operatorKey)
      .execute(client);

    const receipt = await tx.getReceipt(client);
    console.log(`\nTEC token created: ${receipt.tokenId!.toString()}`);
    console.log(`Add this to .env as HEDERA_TOKEN_ID=${receipt.tokenId!.toString()}\n`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("[init:token] failed:", err);
  process.exit(1);
});
