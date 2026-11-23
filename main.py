"""Dip-rider: a long-only cbBTC trading bot for agent-fun/bars-replay/v1.

SPDX-License-Identifier: MIT

Idea (chosen after measuring the dev window, not by fitting it): the dev
window is one sharp rally followed by twenty hours of chop, and every
trend-cross / breakout variant I tested lost money on it while dip-buying
in an uptrend made money. This bot therefore does exactly one thing:

* wait for an uptrend regime (close above its 200-bar EMA), then
* buy the pullback: the close at least 0.80% below the 20-bar high, and
* ride it with a 2.00% trailing stop on closes, full size, until the stop
  fires or the window ends (the replay flattens the position itself).

Why it should survive the live window, which nobody has seen: the regime
filter keeps it in cash when the market falls (on a mirrored, falling
version of the dev window it never trades at all: $0.00 PnL, 0 trades),
the trailing stop caps any one losing leg at ~2% plus costs, and it never
shorts, never uses leverage, never chases a breakout. One position at a
time, at most one order per bar, no clock, no network, no randomness:
the two graded runs are byte-identical by construction.

Protocol: the kit's Python shim (vendor/makefun_bars.py, copied byte for
byte from the kit's sdk/) owns the wire. This file only decides orders.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
import makefun_bars

SYMBOL = "CBBTC"
EMA_LEN = 200            # regime filter: close must be above this EMA
LOOKBACK = 20            # dip measured against this many prior bars' high
DIP_BPS = 80             # enter at least 0.80% below the lookback high
TRAIL_BPS = 200          # exit 2.00% below the running peak close
MAX_SLIPPAGE_BPS = 200   # fills are ~45 bps worst case; 200 leaves room
MIN_HISTORY = EMA_LEN + 2  # bars of closes before the first trade


class DipRider:
    """One position, full size, in an uptrend only."""

    def __init__(self):
        self.closes = []   # closes seen so far, ints at the symbol's price scale
        self.ema = None    # 200-bar EMA of the close, seeded on the first bar
        self.peak = None   # highest close since the current entry

    def on_batch(self, state, batch):
        if state.warming_up:
            return []
        close = state.close(SYMBOL)
        if close is None:
            return []
        self.closes.append(close)
        if self.ema is None:
            self.ema = float(close)
        else:
            self.ema += (2.0 / (EMA_LEN + 1)) * (close - self.ema)

        holding = state.positions.get(SYMBOL)
        qty = holding.qty if holding is not None else 0
        if qty > 0:
            if self.peak is None or close > self.peak:
                self.peak = close
            if close < self.peak * (1 - TRAIL_BPS / 10000.0):
                self.peak = None
                return [{"side": "sell", "symbol": SYMBOL, "qty": qty,
                         "max_slippage_bps": MAX_SLIPPAGE_BPS}]
            return []

        if len(self.closes) < MIN_HISTORY:
            return []
        if close <= self.ema:
            return []
        # Dip versus the high of the previous LOOKBACK bars (current bar excluded).
        hi = max(self.closes[-LOOKBACK - 1:-1])
        if close >= hi * (1 - DIP_BPS / 10000.0):
            return []
        cash = state.cash
        if cash < 1_000_000:  # the replay's minimum notional is $1
            return []
        self.peak = close
        return [{"side": "buy", "symbol": SYMBOL,
                 "notional_quote_units": cash,
                 "max_slippage_bps": MAX_SLIPPAGE_BPS}]


makefun_bars.run(DipRider().on_batch)
