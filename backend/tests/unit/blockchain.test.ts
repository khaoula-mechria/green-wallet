import { describe, it, expect } from "vitest";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { LocalBlockchainService } from "../../src/blockchain/LocalBlockchainService.js";
import { isBlockHashValid, computeBlockHash } from "../../src/blockchain/hash.js";
import { BlockchainRepository } from "../../src/db/repositories/blockchainRepository.js";

describe("LocalBlockchainService — block creation and hashing", () => {
  it("starts with a genesis block", () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);
    const blocks = chain.getChain();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].index).toBe(0);
  });

  it("mines a new block for every recorded transaction, chained to the previous hash", async () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);

    const result1 = await chain.recordTransaction({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amount: 5, payload: {} });
    const result2 = await chain.recordTransaction({ id: "tx-2", type: "TRANSFER", fromId: "h1", toId: "h2", amount: 2, payload: {} });

    const blocks = chain.getChain();
    expect(blocks).toHaveLength(3); // genesis + 2

    expect(result1.blockIndex).toBe(1);
    expect(result2.blockIndex).toBe(2);
    expect(blocks[2].previousHash).toBe(blocks[1].hash);
    expect(blocks[1].previousHash).toBe(blocks[0].hash);
  });

  it("every block's hash is a valid function of its own contents", async () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);
    await chain.recordTransaction({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amount: 5, payload: {} });

    for (const block of chain.getChain()) {
      expect(isBlockHashValid(block)).toBe(true);
    }
  });

  it("detects a tampered block (invalid hash after modification)", async () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);
    await chain.recordTransaction({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amount: 5, payload: {} });

    const block = chain.getBlock(1)!;
    const tampered = { ...block, transactionIds: ["forged-tx"] };
    expect(isBlockHashValid(tampered)).toBe(false);
  });

  it("mined block hashes satisfy the configured proof-of-work difficulty", async () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);
    await chain.recordTransaction({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amount: 5, payload: {} });
    const block = chain.getBlock(1)!;
    expect(block.hash.startsWith("00")).toBe(true);
    expect(block.hash).toBe(computeBlockHash(block));
  });

  it("records the transaction with a null hederaTransactionId in local mode", async () => {
    const db = createInMemoryDatabase();
    const chain = new LocalBlockchainService(db);
    const result = await chain.recordTransaction({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amount: 5, payload: {} });
    expect(result.hederaTransactionId).toBeNull();

    const repo = new BlockchainRepository(db);
    const stored = repo.findTransactionById("tx-1");
    expect(stored?.blockIndex).toBe(1);
  });
});
