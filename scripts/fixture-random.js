// A seeded random number generator and the small helpers the fixture generators share.
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
export const taskId = (rand) => Array.from({length: 22}, () => ALPHABET[Math.floor(rand() * 64)]).join("");
export const revision = (rand) => Array.from({length: 40}, () => Math.floor(rand() * 16).toString(16)).join("");
export const between = (rand, low, high) => low + Math.floor(rand() * (high - low + 1));
export const pick = (rand, list) => list[Math.floor(rand() * list.length)];

export function normal(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}
