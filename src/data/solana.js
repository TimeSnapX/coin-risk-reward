// Minimal Solana helpers (no dependencies): base58, program-derived addresses and associated token
// accounts. Used to read insider wallets' balances with getMultipleAccounts, because keyless RPCs refuse
// the "indexed" getTokenAccountsByOwner call.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(s) {
  let n = 0n; for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
export function b58encode(bytes) {
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
  return s;
}
// ed25519: is this 32-byte string a valid compressed point? (PDAs must be OFF the curve)
const P = 2n ** 255n - 19n, D = (-121665n * inv(121666n)) % P;
function mod(a) { const r = a % P; return r < 0n ? r + P : r; }
function pow(b, e) { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; } return r; }
function inv(a) { return pow(a, P - 2n); }
export function isOnCurve(bytes) {
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  if (y >= P) return false;
  const y2 = mod(y * y), u = mod(y2 - 1n), v = mod(D * y2 + 1n);
  const x2 = mod(u * inv(v));
  if (x2 === 0n) return true;
  return pow(x2, (P - 1n) / 2n) === 1n; // Euler's criterion: x^2 must be a square
}
async function sha256(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0), buf = new Uint8Array(len); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
export async function findProgramAddress(seeds, programId) {
  const prog = b58decode(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = await sha256([...seeds, Uint8Array.of(bump), prog, PDA_MARKER]);
    if (!isOnCurve(h)) return b58encode(h);
  }
  throw new Error("no PDA");
}
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export function associatedTokenAddress(owner, mint, tokenProgram = TOKEN_PROGRAM) {
  return findProgramAddress([b58decode(owner), b58decode(tokenProgram), b58decode(mint)], ATA_PROGRAM);
}
