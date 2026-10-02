/** Seeded, dependency-free PRNG (mulberry32) and the few draws the simulator needs. */

export function createRng(seed) {
  let state = (Number(seed) >>> 0) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.freeze({
    next,
    chance: (p) => next() < p,
    int: (n) => Math.floor(next() * n),
    pick: (list) => list[Math.floor(next() * list.length)],
    /** Exponential with the given mean, at least 1. */
    exponential: (mean) => Math.max(1, Math.round(-Math.log(1 - next()) * mean)),
    /** Poisson by inversion; fine for the small rates used here. */
    poisson(lambda) {
      if (lambda <= 0) return 0;
      const limit = Math.exp(-Math.min(lambda, 700));
      let k = 0;
      let p = next();
      while (p > limit) {
        k += 1;
        p *= next();
      }
      return k;
    },
  });
}
