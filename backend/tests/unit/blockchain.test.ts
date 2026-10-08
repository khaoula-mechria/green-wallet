import { describe, it, expect } from "vitest";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { LocalBlockchainService } from "../../src/blockchain/LocalBlockchainService.js";
import { isBlockHashValid, computeBlockHash } from "../../src/blockchain/hash.js";

describe("LocalBlockchainService — block creation and hashing", () => {
  it("starts with a genesis block", () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);
    const blocks = chain.getChain();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].index).toBe(0);
  });

  it("every block's hash is a valid function of its own contents", () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);

    for (const block of chain.getChain()) {
      expect(isBlockHashValid(block)).toBe(true);
    }
  });

  it("detects a tampered block (invalid hash after modification)", () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);
    const block = chain.getBlock(0)!;
    const tampered = { ...block, transactionIds: ["forged-tx"] };
    expect(isBlockHashValid(tampered)).toBe(false);
  });

  it("recorded transaction blocks satisfy proof-of-work (start with 00)", async () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);

    await chain.recordTransaction({
      id: "tx-1",
      type: "TRANSFER",
      fromId: "h1",
      toId: "h2",
      amount: 5,
      payload: {}
    });

    const block = chain.getBlock(1)!;
    expect(block.hash).toBe(computeBlockHash(block));
    expect(block.hash.startsWith("00")).toBe(true); // Mined blocks have POW property
  });

  it("records a transaction and creates a chained block", async () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);

    const result = await chain.recordTransaction({
      id: "tx-1",
      type: "TRANSFER",
      fromId: "h1",
      toId: "h2",
      amount: 5,
      payload: {}
    });

    expect(result.blockIndex).toBe(1);
    expect(result.blockchainTxId).toBe("tx-1");

    const blocks = chain.getChain();
    expect(blocks).toHaveLength(2); // genesis + 1
    expect(blocks[1].previousHash).toBe(blocks[0].hash);
    expect(blocks[1].transactionIds).toContain("tx-1");
  });

  it("chains multiple recorded transactions into separate blocks", async () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);

    const result1 = await chain.recordTransaction({
      id: "tx-1",
      type: "TRANSFER",
      fromId: "h1",
      toId: "h2",
      amount: 5,
      payload: {}
    });
    const result2 = await chain.recordTransaction({
      id: "tx-2",
      type: "TRANSFER",
      fromId: "h2",
      toId: "h3",
      amount: 3,
      payload: {}
    });

    expect(result1.blockIndex).toBe(1);
    expect(result2.blockIndex).toBe(2);

    const blocks = chain.getChain();
    expect(blocks).toHaveLength(3); // genesis + 2
    expect(blocks[2].previousHash).toBe(blocks[1].hash);
  });
});
