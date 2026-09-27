import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeBlockHash(params: {
  index: number;
  timestamp: number;
  previousHash: string;
  transactionIds: string[];
  nonce: number;
}): string {
  const raw = `${params.index}|${params.timestamp}|${params.previousHash}|${params.transactionIds.join(",")}|${params.nonce}`;
  return sha256(raw);
}

/** Trivial proof-of-work: find a nonce producing a hash with `difficulty` leading zeros.
 * Kept cheap (difficulty=2) so block mining stays instant for demo purposes while still
 * demonstrating the mechanism. */
export function mineBlock(
  params: { index: number; timestamp: number; previousHash: string; transactionIds: string[] },
  difficulty = 2
): { hash: string; nonce: number } {
  const prefix = "0".repeat(difficulty);
  let nonce = 0;
  let hash = computeBlockHash({ ...params, nonce });
  while (!hash.startsWith(prefix)) {
    nonce += 1;
    hash = computeBlockHash({ ...params, nonce });
  }
  return { hash, nonce };
}

export function isBlockHashValid(block: {
  index: number;
  timestamp: number;
  previousHash: string;
  transactionIds: string[];
  nonce: number;
  hash: string;
}): boolean {
  return computeBlockHash(block) === block.hash;
}
