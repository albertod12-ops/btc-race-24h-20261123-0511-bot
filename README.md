# btc-race-24h-20261123-0511-bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/albertod12-ops/btc-race-24h-20261123-0511-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/albertod12-ops/btc-race-24h-20261123-0511-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A long-only cbBTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It waits for an uptrend (close above the 200-bar EMA), buys the pullback (close at least 1.00% below the 20-bar high), rides it with a 2.00% trailing stop that tightens to 0.80% once the position is 2% in profit, and re-enters on the next dip after a stop-out — full size, one position at a time, no shorts, no leverage, no clock, no network, no randomness. On the published dev window it scores about +$21.1 net PnL with a 2.1% maximum drawdown; on a mirrored falling version of that window it never trades, so it cannot bleed in a down market.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout: one JSON line per minute bar in, one reply with its orders out. It runs on Node 22 as `node main.ts`. Grade it locally with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=rbvcjbg9&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
