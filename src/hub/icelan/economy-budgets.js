// SPDX-License-Identifier: MIT
// Separate budgets. A liquidity allocation and a burn allocation are different amounts of the
// same mainnet $RLAN mint. Curve SOL is the existing pool. It is not a burn. An $ICELAN vault
// fund needs an operator bound and cannot take the whole treasury. Nothing here signs.

import { ICELAN_POOL } from "./icelan-tasks.js";

export const RLAN_MINT = "CTyEzEC2WwUgNivmkSp6ZdqnPmBb59EyY4QmCXmFAJiy";
export const ICELAN_MINT = "Dxpt78DTyBv3USxqsFKhQsthTF1JnjdiXQXTPLGBK9m";
/** Treasury token account on hand, 6 decimals. Not the Squads share. */
export const ICELAN_TREASURY_BASE_UNITS = 1415627798000000n;
/** About 1% of the 1.4 billion $ICELAN on hand: 14,000,000 tokens. Not a transfer. */
export const ICELAN_START_TOKENS = 14000000n;
export const ICELAN_START_BASE_UNITS = ICELAN_START_TOKENS * 1000000n;
/** Day-zero vault equals the #183 task-book cap. Not a transfer until the operator signs. */
export const ICELAN_DAY_ZERO_BASE_UNITS = ICELAN_POOL;
export const ICELAN_DAY_ZERO_TOKENS = ICELAN_POOL / 1_000_000n;

function units(value, name) {
  if (typeof value !== "bigint" && (typeof value !== "string" || !/^[0-9]+$/.test(value))) {
    throw new TypeError(`${name} must be a whole number of base units`);
  }
  return BigInt(value);
}

/** Split one $RLAN holding into a pool allocation and a burn allocation. The same units cannot be both. */
export function allocateRlan({ mint, holdingsBaseUnits, poolBaseUnits, burnBaseUnits }) {
  if (mint !== RLAN_MINT) throw new TypeError("pool and burn use the mainnet RLAN mint");
  const holdings = units(holdingsBaseUnits, "holdings");
  const pool = units(poolBaseUnits, "pool");
  const burn = units(burnBaseUnits, "burn");
  if (pool + burn > holdings) throw new RangeError("pool and burn exceed the same holding");
  return Object.freeze({
    mint,
    poolBaseUnits: pool.toString(),
    burnBaseUnits: burn.toString(),
    remainingBaseUnits: (holdings - pool - burn).toString(),
  });
}

/**
 * The bonding curve's SOL is the live pool. It is not converted into an $RLAN burn.
 * `burnBaseUnits` has to come from a separate $RLAN allocation.
 */
export function separatePoolAndBurn({ mint, curveSolLamports, burnBaseUnits }) {
  if (mint !== RLAN_MINT) throw new TypeError("the burn is the mainnet RLAN mint");
  const curve = units(curveSolLamports, "curve");
  const burn = units(burnBaseUnits, "burn");
  if (curve <= 0n) throw new RangeError("the curve is not a pool");
  return Object.freeze({
    mint,
    pool: Object.freeze({ asset: "SOL", lamports: curve.toString() }),
    burn: Object.freeze({ asset: "RLAN", baseUnits: burn.toString() }),
  });
}

/** A vault transfer that stays inside an operator bound and leaves treasury inventory behind. */
export function proposeVaultFund({ amountBaseUnits, boundBaseUnits, treasuryBaseUnits }) {
  if (boundBaseUnits === undefined || boundBaseUnits === null || boundBaseUnits === "") {
    throw new TypeError("an operator bound is required");
  }
  const amount = units(amountBaseUnits, "amount");
  const bound = units(boundBaseUnits, "bound");
  const treasury = units(treasuryBaseUnits, "treasury");
  if (bound <= 0n) throw new RangeError("operator bound must be positive");
  if (amount <= 0n || amount > bound) throw new RangeError("fund amount is outside the operator bound");
  if (amount >= treasury) throw new RangeError("refusing to fund the whole treasury");
  return Object.freeze({ amountBaseUnits: amount.toString(), boundBaseUnits: bound.toString() });
}

/** The starting $ICELAN vault proposal. It does not sign or transfer. */
export function startingIcelanVault() {
  return proposeVaultFund({
    amountBaseUnits: ICELAN_START_BASE_UNITS,
    boundBaseUnits: ICELAN_START_BASE_UNITS,
    treasuryBaseUnits: ICELAN_TREASURY_BASE_UNITS,
  });
}

/** The owner-approved day-zero vault (100,000 ICELAN = the #183 book cap). It does not sign or transfer. */
export function dayZeroIcelanVault() {
  return proposeVaultFund({
    amountBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS,
    boundBaseUnits: ICELAN_DAY_ZERO_BASE_UNITS,
    treasuryBaseUnits: ICELAN_TREASURY_BASE_UNITS,
  });
}
