# 收单清分分录手册

规则只在 ADR 里改。这里只给分录。词见 [CONTEXT.md](../../CONTEXT.md)，原则见 [ADR 0004](../adr/0004-multi-currency-clearing.md)。

默认商户：主币种 USD，开通结算币 {USD}（未特别声明时）。MDR 1.5%，按笔费 $0.30，滚动 5%，本笔固定抽 $2.00。金额四舍五入到分。

---

## A. 同币种：请款 = 结算 = 主币种 = USD

请款 $100。入账汇率 1。入账 $100。

| | 金额 |
|---|---|
| MDR | $1.50 |
| 按笔费 | $0.30 |
| 滚动 | $5.00 |
| 固定 | $2.00 |
| 结算净额 | $91.20 |

```
── CAPTURE 清分（净额留 pending，不可提现）──
  借  clearing:acquiring:USD                 +$100.00
  贷  customer:abc:pending:USD               +$100.00

  借  customer:abc:pending:USD               -$8.80
  贷  customer:abc:reserve:rolling:USD       +$5.00
  贷  customer:abc:reserve:fixed:USD         +$2.00
  贷  revenue:fee:acquiring:USD              +$1.50
  贷  revenue:fee:per_item:USD               +$0.30
  pending 余 $91.20

── SETTLED（可提现、可退款）──
  借  customer:abc:pending:USD               -$91.20
  贷  customer:abc:available:USD             +$91.20
```

退 $30（须 SETTLED；同币种无汇差）：扣 available $30，退 MDR $0.45，退滚动 $1.50。

---

## B. 请款 EUR，未开通 EUR → 结算 USD（主币种）

请款 €100。`booking_fx_rate` 1.10。入账 $110.00。

| | 计价 | 扣账 |
|---|---|---|
| MDR | €100 × 1.5% = €1.50 | $1.65 |
| 按笔费 | 标价 $0.30 | $0.30（结算=主币种，不用折） |
| 滚动 | $110 × 5% | $5.50 |
| 固定 | 主币种 | $2.00 |
| 结算净额 | | $100.55 |

```
── CAPTURE 换汇入账 + 清分（净额留 pending）──
  借  clearing:acquiring:USD                 +$110.00
  贷  customer:abc:pending:USD               +$110.00

  借  customer:abc:pending:USD               -$9.45
  贷  customer:abc:reserve:rolling:USD       +$5.50
  贷  customer:abc:reserve:fixed:USD         +$2.00
  贷  revenue:fee:acquiring:USD              +$1.65
  贷  revenue:fee:per_item:USD               +$0.30
  pending 余 $100.55

── SETTLED ──
  借  customer:abc:pending:USD               -$100.55
  贷  customer:abc:available:USD             +$100.55
```

上游若清算 EUR，另记，不进商户净额。`payable:acquirer:{ccy}` = 应付通道费用（ADR 0005）：

```
  借  expense:card_network_fee:EUR           +€1.20
  贷  payable:acquirer:EUR                   +€1.20
```

### 退款 €30，即期 1.20

退款入账 $36.00。退 MDR $0.50。退滚动 $1.65（请款比例，不是 36/110）。按笔费、固定不动。

```
  借  customer:abc:available:USD             -$36.00
  贷  clearing:acquiring:USD                 -$36.00

  借  revenue:fee:acquiring:USD              -$0.50
  贷  customer:abc:available:USD             +$0.50

  借  customer:abc:reserve:rolling:USD       -$1.65
  贷  customer:abc:available:USD             +$1.65
```

这 €30 入账时是 $33，退款扣 $36：商户承担 $3 汇差。

### VOID（未 SETTLED）

按入账汇率 1.10 全额冲回，含按笔费与固定。

---

## C. 开通 EUR：请款 EUR = 结算 EUR，主币种 USD

请款 €100。入账 €100。EUR→USD 入账汇率 1.10（只用于按笔费和固定折主币种）。

| | |
|---|---|
| MDR | €1.50，扣 EUR |
| 按笔费 | 标价 $0.30 → **扣 EUR €0.27**，不扣 USD 账户 |
| 滚动 | €5.00，`reserve:rolling:EUR` |
| 固定 | $2.00 ← 从 EUR 扣 €1.82 换入 `reserve:fixed:USD` |
| 结算净额 | €91.41 → SETTLED 前在 `pending:EUR` |

```
── CAPTURE ──
  借  clearing:acquiring:EUR                 +€100.00
  贷  customer:abc:pending:EUR               +€100.00

  借  customer:abc:pending:EUR               -€8.59
  贷  customer:abc:reserve:rolling:EUR       +€5.00
  贷  revenue:fee:acquiring:EUR              +€1.50
  贷  revenue:fee:per_item:EUR               +€0.27
  贷  clearing:fx:EUR_USD                    +€1.82

  借  clearing:fx:EUR_USD                    +$2.00
  贷  customer:abc:reserve:fixed:USD         +$2.00
  pending 余 €91.41

── SETTLED ──
  借  customer:abc:pending:EUR               -€91.41
  贷  customer:abc:available:EUR             +€91.41
```

EUR rolling **不能**升级成 USD 固定，到期释放进 `available:EUR`（须已 SETTLED，或释放进 pending 再随 SETTLED 转）。

---

## D. 接 C：退 €40，EUR 钱包不够，主币种兜底

`fallback_fx_rate`（EUR→USD）1.20。退款入账 €40。`available:EUR` 仅 €10，`available:USD` $100。

1. 扣 EUR €10  
2. 缺口 €30 × 1.20 = $36，扣 USD  
3. 退 MDR €0.60、退滚动 €2.00，贷回 **EUR**

```
  借  customer:abc:available:EUR             -€10.00
  借  customer:abc:available:USD             -$36.00
  贷  clearing:acquiring:EUR                 -€40.00
  贷  clearing:fx:EUR_USD                    -€30.00
  借  clearing:fx:EUR_USD                    +$36.00

  借  revenue:fee:acquiring:EUR              -€0.60
  贷  customer:abc:available:EUR             +€0.60

  借  customer:abc:reserve:rolling:EUR       -€2.00
  贷  customer:abc:available:EUR             +€2.00
```

USD 也只有 $10 时：先扣光 $10，缺口 $26 记在 `available:USD` 为负（−$26）。EUR 不产生负余额。pending / reserve 不扣。

---

## E. 未开通币：请款 THB → 结算主币种 USD

请款 THB 3,500。`booking_fx_rate` 35 THB/USD。入账 $100.00。

MDR = THB 3,500 × 1.5% 再折 USD，**不要** $100 × 1.5%。

| | |
|---|---|
| MDR | THB 52.50 → $1.50 |
| 按笔费 | $0.30 |
| 滚动 | $5.00 |
| 固定 | $2.00 |
| 结算净额 | $91.20 |

分录形态同 A/B，账户全是 USD。退款用 `refund_fx_rate`（即期）折 USD 扣 `available:USD`。

---

## F. 对照：不要写成这样

| 错 | 对 |
|---|---|
| 退款用入账汇率 | 退款用即期 / 通道价 |
| 按笔费从 USD 钱包扣，EUR 单却结算 EUR | 按笔费扣 `available:EUR` |
| IC% 按商户结算额重算 | 上游给多少记多少 |
| 滚动按退款入账/入账金额（即期）退 | 按请款金额比例退 |
| EUR rolling 升级进 USD 固定 | 只升 `rolling:USD` → `fixed:USD` |
| 从 pending 退款 | SETTLED 后扣 available；之前 VOID |

---

## G. 同币种退款：滚动 HELD（ADR 0001 Case 1）

本例 MDR **1%**（与文首默认 1.5% 不同）。原请款 $100，滚动 $5，MDR $1.00。退 $30。

```
  借  customer:abc:available:USD             -$30.00
  贷  clearing:acquiring:USD                 -$30.00

  借  revenue:fee:acquiring:USD              -$0.30
  贷  customer:abc:available:USD             +$0.30

  借  customer:abc:reserve:rolling:USD       -$1.50
  贷  customer:abc:available:USD             +$1.50
```

净：available −$28.20。

滚动已 RELEASED / RESERVE_RELEASED：无第三条。固定保证金：永不退。

---

## H. 争议（须已 SETTLED）

不能从 CAPTURED 进入。进行中从 available 冻争议额；败诉先扣该笔滚动 HELD，再 frozen_hold，再 available，再主币种。不退 MDR。

```
── DISPUTED ──
  借  customer:abc:available:USD             -$30.00
  贷  customer:abc:frozen_hold:USD           +$30.00

── DISPUTE_WON ──
  借  customer:abc:frozen_hold:USD           -$30.00
  贷  customer:abc:available:USD             +$30.00

── DISPUTE_LOST（滚动仍 HELD $5 先顶）──
  借  customer:abc:reserve:rolling:USD       -$5.00
  借  customer:abc:frozen_hold:USD           -$30.00
  贷  clearing:acquiring:USD                 -$35.00
```
