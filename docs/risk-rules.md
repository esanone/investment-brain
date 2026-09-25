# Risk rules: sources and reconciliation

Research brief (September 2026) behind the Portfolio engine v2 defaults. Verification key: [P] primary text read, [S] secondary source, [U] unverified.

## Entry
- Minervini trend template [S]: price > 150 & 200-day; 150 > 200; 200-day rising ≥ 1 month; 50 > 150 > 200; price > 50-day; ≥ 25–30% above the 52-week low; within 25% of the 52-week high; RS rank ≥ 70. (chartmill.com, sharpely.in)
- Weinstein Stage 2 [S]: buy breakouts above a rising 30-week average on 2–3× volume; exit on a close below a declining 30-week average (Stage 4). (thepatternsite.com, traderlion.com)
- O'Neil CAN SLIM [S]: EPS ≥ +25%, breakout from ≥ 7-week base within 5% of pivot on +40–50% volume, only in a confirmed uptrend. (Wikipedia, AAII)
- Faber 2007/2013 [P]: hold when monthly close > 10-month SMA else T-bills; S&P 1901–2012 drawdown 2000–02 16.5% vs 44.7%, avoided the 2008 51% drawdown at a ~1pt CAGR cost. (mebfaber.com PDF, SSRN 962461)
- Antonacci 2012 [P]: 12-month absolute momentum vs T-bills; equities module 1974–2011 Sharpe 0.73 vs 0.35, max drawdown −23% vs −51%. (SSRN 2042750)

## Exits
- O'Neil [S]: cut losses at 7–8%; take most profits at 20–25%; sell on two quarters of EPS deceleration.
- Minervini [S]: max stop 10%, average loss 5–6%, risk 1.25–2.5% per trade, sell partial into strength at 2–3R.
- Chandelier exit (LeBeau) [P]: 22-day high − 3 × ATR(22). (StockCharts)
- Turtle rules [P]: 2N stop, 1% of equity per unit, cut notional 20% per 10% drawdown.
- Kaminski & Lo 2014 [P]: stops add value in momentum regimes, subtract in mean-reverting ones; monthly/quarterly evaluation beats daily. (MIT DSpace)
- Han, Zhou & Zhu [P]: 10% stop on momentum stocks cut the worst month from −50% to −11% (5% too tight, 15% too loose).

## Sizing and drawdown
- Hite / Seykota / Turtles: ~1% risk per position. Thorp: half-Kelly keeps 75% of growth with far less ruin risk.
- Dalio All Weather [P]: risk, not dollars, split across growth/inflation boxes.
- Marks [P]: hold cash when nothing is on offer; sell on a weaker thesis or better opportunity, not on price alone.
- Pod-shop limits [S]: ~5% drawdown halves risk, ~7.5% closes the book.

## News and filings
- PEAD (Bernard & Thomas): ~2% further drift over 60 days after bad surprises, so act promptly.
- Opportunistic insider sales (Cohen, Malloy & Pomorski 2012): ≈ −78 bps/month abnormal.
- Lynch: write the reasons at entry; sell when they fail, not because the price fell.

## Open items
Minervini 25% vs 30% above the 52-week low (book says 30%); no numeric drawdown ladder attributable to Tudor Jones; 8-K item rules and Form 4 ingestion are Phase 2.
