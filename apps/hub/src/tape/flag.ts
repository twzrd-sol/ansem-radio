// Mainnet shows the live arena tape. Demo fixtures stay behind ?tape=demo.
// A devnet build stays off unless VITE_HUB_MARKET_BOARD=1.
import { IS_MAINNET } from "../chain/config";

export const MARKET_BOARD_FLAG = "VITE_HUB_MARKET_BOARD";

export function marketBoardEnabled(env: { VITE_HUB_MARKET_BOARD?: string } = { VITE_HUB_MARKET_BOARD: import.meta.env.VITE_HUB_MARKET_BOARD }, mainnet = IS_MAINNET): boolean {
  if (mainnet) return true;
  return env.VITE_HUB_MARKET_BOARD === "1";
}

export const MARKET_BOARD_ENABLED = marketBoardEnabled();
