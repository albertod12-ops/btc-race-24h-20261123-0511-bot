// Dip-rider: a long-only cbBTC trading bot for agent-fun/bars-replay/v1.
//
// SPDX-License-Identifier: MIT
//
// Idea (chosen after measuring the dev window, not by fitting it): the dev
// window is one sharp rally followed by twenty hours of chop, and every
// trend-cross / breakout variant I tested lost money on it while dip-buying
// in an uptrend made money. This bot therefore does exactly one thing:
//
// * wait for an uptrend regime (close above its 200-bar EMA), then
// * buy the pullback: the close at least 0.80% below the 20-bar high, and
// * ride it with a 2.00% trailing stop on closes, full size, until the stop
//   fires or the window ends (the replay flattens the position itself).
//
// Why it should survive the live window, which nobody has seen: the regime
// filter keeps it in cash when the market falls (on a mirrored, falling
// version of the dev window it never trades at all: $0.00 PnL, 0 trades),
// the trailing stop caps any one losing leg at ~2% plus costs, and it never
// shorts, never uses leverage, never chases a breakout. One position at a
// time, at most one order per bar, no clock, no network, no randomness:
// the two graded runs are byte-identical by construction.
//
// Protocol: the kit's TypeScript shim (vendor/makefun-bars.ts, copied byte
// for byte from the kit's sdk/) owns the wire. This file only decides orders.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const EMA_LEN = 200;              // regime filter: close must be above this EMA
const LOOKBACK = 20;              // dip measured against this many prior bars' high
const DIP_BPS = 80;               // enter at least 0.80% below the lookback high
const TRAIL_BPS = 200;            // exit 2.00% below the running peak close
const MAX_SLIPPAGE_BPS = 200;     // fills are ~45 bps worst case; 200 leaves room
const MIN_HISTORY = EMA_LEN + 2;  // bars of closes before the first trade
const MIN_NOTIONAL = 1_000_000n;  // the replay's minimum notional is $1

class DipRider {
  private closes: number[] = []; // closes seen so far, at the symbol's price scale
  private ema: number | null = null; // 200-bar EMA of the close, seeded on the first bar
  private peak: number | null = null; // highest close since the current entry

  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const closeBig = state.close(SYMBOL);
    if (closeBig === null) return [];
    const close = Number(closeBig);
    this.closes.push(close);
    if (this.ema === null) {
      this.ema = close;
    } else {
      this.ema += (2 / (EMA_LEN + 1)) * (close - this.ema);
    }

    const holding = state.positions.get(SYMBOL);
    const qty = holding === undefined ? 0n : holding.qty;
    if (qty > 0n) {
      // Ride the position: the peak only ever rises, so the stop only ever
      // rises with it; a close 2% below the peak ends the trade.
      if (this.peak === null || close > this.peak) this.peak = close;
      if (close < this.peak * (1 - TRAIL_BPS / 10000)) {
        this.peak = null;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (this.closes.length < MIN_HISTORY) return [];
    if (this.ema === null || close <= this.ema) return [];
    // Dip versus the high of the previous LOOKBACK bars (current bar excluded).
    const hi = Math.max(...this.closes.slice(-LOOKBACK - 1, -1));
    if (close >= hi * (1 - DIP_BPS / 10000)) return [];
    if (state.cash < MIN_NOTIONAL) return [];
    this.peak = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
}

const bot = new DipRider();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
