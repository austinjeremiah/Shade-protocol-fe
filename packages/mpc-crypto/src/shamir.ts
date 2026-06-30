import { randomBytes } from "node:crypto";
import type { Share } from "./types.js";

// BN254 prime field — same field used by the ZK circuits.
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function modp(x: bigint): bigint {
  return ((x % P) + P) % P;
}

// Extended-GCD based modular inverse.
function modinv(a: bigint): bigint {
  let [old_r, r] = [modp(a), P];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return modp(old_s);
}

function randomFieldElement(): bigint {
  // Sample a random 254-bit integer and reduce mod P.
  const buf = randomBytes(32);
  return modp(BigInt("0x" + buf.toString("hex")));
}

/**
 * Split `secret` (a bigint in [0, P)) into `total` shares with threshold `t`.
 * Any t shares can reconstruct; fewer reveal nothing about the secret.
 */
export function shamirSplit(secret: bigint, threshold: number, total: number): Share[] {
  if (threshold < 2 || threshold > total) throw new Error("invalid threshold");
  // Polynomial: f(x) = secret + a1*x + ... + a_{t-1}*x^{t-1}
  const coeffs: bigint[] = [modp(secret)];
  for (let i = 1; i < threshold; i++) coeffs.push(randomFieldElement());

  return Array.from({ length: total }, (_, i) => {
    const x = BigInt(i + 1);
    let y = 0n;
    for (let j = coeffs.length - 1; j >= 0; j--) {
      y = modp(y * x + coeffs[j]);
    }
    return { x, y };
  });
}

/**
 * Reconstruct the secret from `threshold` or more shares via Lagrange interpolation.
 */
export function shamirReconstruct(shares: Share[]): bigint {
  let secret = 0n;
  for (let i = 0; i < shares.length; i++) {
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      num = modp(num * modp(-shares[j].x));
      den = modp(den * (shares[i].x - shares[j].x));
    }
    secret = modp(secret + modp(shares[i].y * modp(num * modinv(den))));
  }
  return secret;
}

/** Encode a share for JSON transport. */
export function encodeShare(share: Share): { x: string; y: string } {
  return { x: share.x.toString(), y: share.y.toString() };
}

/** Decode a share from JSON transport. */
export function decodeShare(encoded: { x: string; y: string }): Share {
  return { x: BigInt(encoded.x), y: BigInt(encoded.y) };
}
