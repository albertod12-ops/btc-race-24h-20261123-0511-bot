// Dip-rider v2: a long-only cbBTC trading bot for agent-fun/bars-replay/v1.
//
// SPDX-License-Identifier: MIT
//
// v2 upgrades v1 in three ways, each measured on the dev window first:
//   1. Deeper value entry: 1.00% below the 20-bar high instead of 0.80%.
//      The dev window's rally pulled back ~1.1% before running, so the
//      deeper dip buys the same leg ~$110 cheaper per BTC.
//   2. Gain-lock ratchet: once the position is 2% above its entry, the
//      trailing stop tightens from 2.00% to 0.80%, so a rally that reverses
//      keeps most of its gain instead of giving 2% back.
//   3. Re-entry: after the ratchet stops the bot out, a fresh dip buys the
//      next leg instead of sitting in cash for the rest of the window.
//
// Dev window: v2 +$21.08 net PnL, 2.1% max drawdown, 4 trades (2 entries)
// vs v1 +$19.66, 2.0% drawdown, 1 entry. On a mirrored falling window both
// stay in cash ($0.00, 0 trades): the regime filter is what protects them.
//
// Why it should survive the live window, which nobody has seen: the regime
// filter keeps it in cash when the market falls, the trailing stop caps
// any one losing leg at ~2% plus costs, and it never shorts, never uses
// leverage, never chases a breakout. One position at a time, at most one
// order per bar, no clock, no network, no randomness: the two graded runs
// are byte-identical by construction.
//
// Protocol: the kit's TypeScript shim (vendor/makefun-bars.ts, copied byte
// for byte from the kit's sdk/) owns the wire. This file only decides orders.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const EMA_LEN = 200;              // regime filter: close must be above this EMA
const LOOKBACK = 20;              // dip measured against this many prior bars' high
const DIP_BPS = 100;              // enter at least 1.00% below the lookback high
const TRAIL_BPS = 200;            // exit 2.00% below the running peak close
const ARM_BPS = 200;              // past this gain above entry, the trail tightens
const TIGHT_TRAIL_BPS = 80;       // tightened trail: 0.80% below the peak close
const MAX_SLIPPAGE_BPS = 200;     // fills are ~45 bps worst case; 200 leaves room
const MIN_HISTORY = EMA_LEN + 2;  // bars of closes before the first trade
const MIN_NOTIONAL = 1_000_000n;  // the replay's minimum notional is $1

class DipRider {
  private closes: number[] = []; // closes seen so far, at the symbol's price scale
  private ema: number | null = null; // 200-bar EMA of the close, seeded on the first bar
  private peak: number | null = null; // highest close since the current entry
  private entry: number | null = null; // close at which the current position was entered

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
      if (this.peak === null || close > this.peak) this.peak = close;
      // Gain-lock ratchet: past ARM_BPS above the entry, the trail tightens.
      const trail = this.entry !== null && close > this.entry * (1 + ARM_BPS / 10000)
        ? TIGHT_TRAIL_BPS : TRAIL_BPS;
      if (close < this.peak * (1 - trail / 10000)) {
        this.peak = null;
        this.entry = null;
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
    this.entry = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
}

const bot = new DipRider();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
