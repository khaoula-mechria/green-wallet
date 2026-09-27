import { describe, it, expect } from "vitest";
import { createInMemoryDatabase } from "../../src/db/database.js";
import { LocalBlockchainService } from "../../src/blockchain/LocalBlockchainService.js";
import { isBlockHashValid, computeBlockHash, transactionsDigest } from "../../src/blockchain/hash.js";
import { BlockchainRepository, type BlockchainTransactionRow } from "../../src/db/repositories/blockchainRepository.js";

function setup() {
  const db = createInMemoryDatabase();
  const chain = new LocalBlockchainService(db);
  const repo = new BlockchainRepository(db);
  const txsOf = (index: number) => chain.getBlock(index)!.transactionIds.map((id) => repo.findTransactionRow(id)!) as BlockchainTransactionRow[];
  return { db, chain, repo, txsOf };
}

describe("LocalBlockchainService — block creation and hashing", () => {
  it("starts with a genesis block", () => {
    const { chain } = setup();
    const blocks = chain.getChain();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].index).toBe(0);
  });

  it("mines a new block for every recorded transaction, chained to the previous hash", () => {
    const { chain } = setup();

    const result1 = chain.append({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amountMicro: 5_000_000, payload: {} });
    const result2 = chain.append({ id: "tx-2", type: "TRANSFER", fromId: "h1", toId: "h2", amountMicro: 2_000_000, payload: {} });

    const blocks = chain.getChain();
    expect(blocks).toHaveLength(3); // genesis + 2

    expect(result1.blockIndex).toBe(1);
    expect(result2.blockIndex).toBe(2);
    expect(blocks[2].previousHash).toBe(blocks[1].hash);
    expect(blocks[1].previousHash).toBe(blocks[0].hash);
  });

  it("every block's hash is a valid function of its own contents", () => {
    const { chain, txsOf } = setup();
    chain.append({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amountMicro: 5_000_000, payload: {} });

    for (const block of chain.getChain()) {
      expect(isBlockHashValid(block, txsOf(block.index))).toBe(true);
    }
  });

  it("detects a tampered block (invalid hash after modification)", () => {
    const { chain, txsOf } = setup();
    chain.append({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amountMicro: 5_000_000, payload: {} });

    const block = chain.getBlock(1)!;
    const tampered = { ...block, transactionIds: ["forged-tx"] };
    expect(isBlockHashValid(tampered, txsOf(1))).toBe(false);
  });

  it("detects a transaction whose contents were altered after it was sealed in a block", () => {
    const { chain, txsOf } = setup();
    chain.append({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amountMicro: 5_000_000, payload: {} });

    const [tx] = txsOf(1);
    expect(isBlockHashValid(chain.getBlock(1)!, [{ ...tx, amountMicro: 500_000_000 }])).toBe(false);
  });

  it("mined block hashes satisfy the configured proof-of-work difficulty", () => {
    const { chain, txsOf } = setup();
    chain.append({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amountMicro: 5_000_000, payload: {} });
    const block = chain.getBlock(1)!;
    expect(block.hash.startsWith("00")).toBe(true);
    expect(block.hash).toBe(computeBlockHash(block, transactionsDigest(txsOf(1))));
  });

  it("records the transaction in its block, unanchored, in local mode", () => {
    const { chain, repo } = setup();
    chain.append({ id: "tx-1", type: "MINT", fromId: null, toId: "h1", amountMicro: 5_000_000, payload: {} });

    const stored = repo.findTransactionById("tx-1");
    expect(stored?.blockIndex).toBe(1);
    expect(stored?.hederaTransactionId).toBeNull();
    expect(stored?.anchorStatus).toBe("none");
    expect(stored?.amount).toBe(5);
  });
});
