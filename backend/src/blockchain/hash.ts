import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** The ledger-relevant contents of a transaction. Anchoring metadata (block
 * index, external tx id, retry state) is deliberately excluded: it's filled in
 * after the block is sealed. */
export interface HashableTransaction {
  id: string;
  type: string;
  fromId: string | null;
  toId: string;
  amountMicro: number;
  timestamp: number;
  payload: string;
}

/** Digest committing to every listed transaction's contents, in block order.
 * JSON arrays make the encoding unambiguous (no delimiter collisions). */
export function transactionsDigest(transactions: HashableTransaction[]): string {
  return sha256(
    JSON.stringify(transactions.map((t) => [t.id, t.type, t.fromId, t.toId, t.amountMicro, t.timestamp, t.payload]))
  );
}

export interface BlockHeader {
  index: number;
  timestamp: number;
  previousHash: string;
  transactionIds: string[];
  nonce: number;
}

/**
 * v1 (legacy blocks only): commits to transaction *ids* — editing a
 * transaction's amount in place would go undetected.
 * v2: also commits to a digest of the transactions' contents.
 */
export function computeBlockHash(block: BlockHeader & { hashVersion?: 1 | 2 }, txDigest?: string): string {
  if ((block.hashVersion ?? 2) === 1) {
    return sha256(`${block.index}|${block.timestamp}|${block.previousHash}|${block.transactionIds.join(",")}|${block.nonce}`);
  }
  if (txDigest === undefined) throw new Error("v2 block hash requires the transactions digest");
  return sha256(`v2|${block.index}|${block.timestamp}|${block.previousHash}|${block.transactionIds.join(",")}|${txDigest}|${block.nonce}`);
}

export const POW_DIFFICULTY = 2;

/** Trivial proof-of-work: find a nonce producing a hash with `difficulty` leading zeros.
 * Kept cheap (difficulty=2) so block mining stays instant for demo purposes while still
 * demonstrating the mechanism. */
export function mineBlock(
  header: Omit<BlockHeader, "nonce">,
  txDigest: string,
  difficulty = POW_DIFFICULTY
): { hash: string; nonce: number } {
  const prefix = "0".repeat(difficulty);
  let nonce = 0;
  let hash = computeBlockHash({ ...header, nonce, hashVersion: 2 }, txDigest);
  while (!hash.startsWith(prefix)) {
    nonce += 1;
    hash = computeBlockHash({ ...header, nonce, hashVersion: 2 }, txDigest);
  }
  return { hash, nonce };
}

export function isBlockHashValid(
  block: BlockHeader & { hash: string; hashVersion: 1 | 2 },
  transactions: HashableTransaction[] = []
): boolean {
  const digest = block.hashVersion === 2 ? transactionsDigest(transactions) : undefined;
  return computeBlockHash(block, digest) === block.hash;
}
