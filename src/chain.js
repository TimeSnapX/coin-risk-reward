// Chain auto-detect + secret rejection. Pure functions (unit-tested in node).
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s) {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) return null;
  const bytes = [0];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

// Returns a reason string if the text looks like a private key or seed phrase, else null.
export function secretReason(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const words = t.toLowerCase().split(/\s+/);
  if ([12, 15, 18, 21, 24].includes(words.length) && words.every((w) => /^[a-z]{3,8}$/.test(w))) return "That looks like a seed phrase";
  if (/\[\s*\d{1,3}(\s*,\s*\d{1,3}){31,}\s*\]/.test(t)) return "That looks like a private key byte array";
  for (const tok of t.split(/[\s,;]+/)) {
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(tok)) return "That looks like a private key (64 hex characters)";
    if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(tok)) { const b = base58Decode(tok); if (b && b.length === 64) return "That looks like a Solana private key"; }
    if (/^(xprv|tprv|L|K|5)[1-9A-HJ-NP-Za-km-z]{50,}$/.test(tok) && tok.length >= 51 && tok.length <= 112 && !/pump$/.test(tok)) return "That looks like a wallet private key";
  }
  return null;
}

// Extract candidate addresses from pasted text (CA, list, or pump.fun / explorer URLs).
export function extractCandidates(text) {
  const out = [];
  for (let tok of String(text || "").split(/[\s,;|]+/)) {
    tok = tok.trim().replace(/^['"`(<]+|['"`)>.]+$/g, "");
    if (!tok) continue;
    const m = tok.match(/(?:pump\.fun\/(?:coin\/)?|solscan\.io\/token\/|birdeye\.so\/token\/|jup\.ag\/swap\/[^/]*-?)([1-9A-HJ-NP-Za-km-z]{32,44})/);
    if (m) tok = m[1];
    else if (/^https?:/.test(tok)) { const tail = tok.split(/[/?#]/).filter(Boolean).pop(); tok = tail || tok; }
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

export function detectChain(addr) {
  const a = String(addr || "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return { chain: "evm", label: "EVM (Ethereum/Base/BSC…)", supported: false, note: "EVM coming later. Solana first." };
  if (/^0x[0-9a-fA-F]{64}$/.test(a)) return { chain: "sui-aptos", label: "Sui / Aptos", supported: false, note: "Not supported yet." };
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return { chain: "tron", label: "TRON", supported: false, note: "Not supported yet." };
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a) && !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(a)) return { chain: "bitcoin", label: "Bitcoin address", supported: false, note: "Bitcoin has no token contracts to check." };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) { const b = base58Decode(a); if (b && b.length === 32) return { chain: "solana", label: "Solana", supported: true }; }
  return { chain: "unknown", label: "Not recognised", supported: false, note: "Not a Solana mint or EVM contract address." };
}
