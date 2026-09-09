# 0004 多币种清分与退款汇率

下游按请款 / 入账 / 结算 / 主币种分账。CAPTURE 按当时牌价换汇入账（入账汇率）；退款商户侧用即期（有通道价则跟通道）。汇差由商户承担，平台不对退款做 FX 自营。入账汇率不是锁汇。

术语见 [CONTEXT.md](../../CONTEXT.md)。

## 核心原则

1. **四币分离。** 请款币种、该笔结算币种、主币种、上游结算币种各自记账，互不重算。
2. **CAPTURE 换汇入账。** `booking_amount = presentment_amount × booking_fx_rate`（同币种汇率为 1）。这是入账时的一次换汇，不是锁汇。VOID 冲原换汇分录，仍用这笔入账汇率。
3. **标价币与扣账币可以不同；扣账跟该笔结算钱包。** MDR 按请款金额计价，扣结算币种；按笔费按主币种**标价**，用入账汇率折成结算币种后从**该笔结算钱包**扣，不另扣主币种钱包；滚动留结算币种；固定目标在主币种。
4. **上游成本只收录。** interchange / scheme / 通道费以结算文件的固定额记入 `channel_settlement_currency`，不按 IRF 表重算，也不编进商户净额。
5. **退款汇率用即期。** 买家退原请款金额；商户扣 `refund_booking_amount = refund_presentment_amount × refund_fx_rate`。`refund_fx_rate` 优先用通道该笔退款汇率，否则用退款时牌价。不用 `booking_fx_rate`。
6. **VOID 冲原入账汇率。** 未 SETTLED 的撤销是原分录反向，不是一笔新的 FX。
7. **滚动退回按请款比例。** `rolling_return = refund_presentment_amount / presentment_amount × original_rolling_reserve`，币种仍是原结算币种。不用入账即期比例。
8. **负余额不跨币。** 退款只落在该笔 `settlement_currency` 的 available。

### 为何不叫锁汇

CAPTURE 换汇只决定当时怎么把请款金额写成入账金额。退款买家必须拿回原请款金额，平台按即期备请款币；若商户仍按入账汇率扣，汇差在平台。故退款用即期，入账汇率不作双向保证。

### 按笔费：标价主币种，扣该笔结算钱包

合同写 `$0.10`（主币种），不等于从 USD 账户扣 $0.10。

请款 EUR、结算 EUR、主币种 USD、入账汇率 1.10：

| 做法 | 分录 | 结论 |
|---|---|---|
| **采用：折成结算币种扣** | `available:EUR -€0.09`，收入记 EUR | 和这笔资金同一条腿；EUR-only 商户不必先有 USD |
| 不用：扣主币种钱包 | `available:USD -$0.10` | USD 没余额就变负；退款不退按笔费时 USD 缺口一直在 |

退款手续费同一规则：主币种标价，扣该笔结算钱包。

## 扣款顺序（CAPTURE）

```
请款金额 × booking_fx_rate → 入账金额（settlement_currency）
  → MDR（请款金额 × 费率，折结算币种）
  → 按笔费（主币种标价，折结算币种，扣结算钱包）
  → 滚动保证金（入账金额 × 比率，settlement_currency）
  → 固定保证金（折主币种，受目标差额与剩余封顶）
  → 结算净额 → available:{settlement_currency}
```

结算币种 = 请款币种 ∈ 开通集 ? 请款币种 : 主币种。

## 退款时处理

| 项 | 退不退 | 金额 |
|---|---|---|
| 买家 | 退 | 退款请款金额（请款币种） |
| 商户 available | 扣 | 退款入账金额（即期） |
| MDR | 按请款比例退 | 原 MDR × 退款请款 / 原请款 |
| 按笔费 | 不退 | — |
| 滚动 HELD | 按请款比例退 | 见原则 7 |
| 滚动已释放 / 已升级 | 不退 | — |
| 固定保证金 | 不退 | — |
| 退款手续费 | 另扣 | 主币种标价，折该笔结算币种 |
| 上游 IC / scheme | 通道给多少记多少 | `channel_settlement_currency` |

校验：`refund_presentment_amount` 累计 ≤ 原请款金额。尾笔请款侧吃分位；入账侧不强制加总还原入账金额。

---

## 记账样例

以下商户主币种 USD，按笔费 $0.30，MDR 1.5%，滚动 5%，固定目标未封顶、本笔抽 $2。金额四舍五入到分。

### 1. 同币种 CAPTURE（请款 = 结算 = 主币种 = USD）

请款 $100，入账汇率 1。入账 $100。MDR $1.50，按笔 $0.30，滚动 $5.00，固定 $2.00，结算净额 $91.20。

```
── CAPTURE 入账 ──
  借  receivable:txn:USD                     +$100.00
  贷  customer:abc:pending:USD               +$100.00

── CAPTURE 清分 ──
  借  customer:abc:pending:USD               -$100.00
  贷  customer:abc:available:USD             +$91.20
  贷  customer:abc:reserve:rolling:USD       +$5.00
  贷  customer:abc:reserve:fixed:USD         +$2.00
  贷  revenue:fee:acquiring:USD              +$1.50
  贷  revenue:fee:per_item:USD               +$0.30
```

同币种退款即期无意义，退 $30 时退款入账 $30，滚动退回 $30/$100 × $5 = $1.50，MDR 退 $0.45。与 ADR 0001 同币种分录相同。

### 2. 跨币种 CAPTURE（请款 EUR，结算与主币种 USD）

请款 €100，`booking_fx_rate` = 1.10。入账 $110.00。

- MDR = €100 × 1.5% = €1.50 → $1.65（按请款计价再折，不按 $110 × 1.5%）
- 按笔费 $0.30
- 滚动 = $110 × 5% = $5.50
- 固定 $2.00（主币种）
- 结算净额 $100.55

```
── CAPTURE 换汇入账（入账汇率 1.10）──
  借  receivable:txn:USD                     +$110.00
  贷  customer:abc:pending:USD               +$110.00

── CAPTURE 清分 ──
  借  customer:abc:pending:USD               -$110.00
  贷  customer:abc:available:USD             +$100.55
  贷  customer:abc:reserve:rolling:USD       +$5.50
  贷  customer:abc:reserve:fixed:USD         +$2.00
  贷  revenue:fee:acquiring:USD              +$1.65
  贷  revenue:fee:per_item:USD               +$0.30
```

上游 IC / scheme 若通道清算 EUR，另记，与上表独立：

```
  借  expense:card_network_fee:EUR           +€1.20
  贷  receivable:txn:EUR                     -€1.20     // 或对通道应付款，按结算文件
```

### 3. 跨币种部分退款（即期）

原单同例 2。退 €30，`refund_fx_rate` = 1.20。滚动仍为 HELD。

- 退款请款 €30（买家）
- 退款入账 $36.00（商户扣 available）
- 退 MDR = €30/€100 × $1.65 = $0.50（四舍五入）
- 退滚动 = €30/€100 × $5.50 = $1.65
- 按笔费、固定不动

```
── 退款（商户账，即期 1.20）──
  借  customer:abc:available:USD             -$36.00
  贷  receivable:txn:USD                     -$36.00

  借  revenue:fee:acquiring:USD              -$0.50
  贷  customer:abc:available:USD             +$0.50

  借  customer:abc:reserve:rolling:USD       -$1.65
  贷  customer:abc:available:USD             +$1.65
```

相对 CAPTURE 时这 €30 对应的入账 $33，商户多扣 $3，即汇差。平台用 $36 备付 €30，轧平。

若滚动已 RELEASED / RESERVE_RELEASED：无第三条，available 净额 -$35.50。

### 4. 跨币种全额退款（滚动 HELD）

退 €100，即期仍 1.20。退款入账 $120.00。MDR 全退 $1.65，滚动全退 $5.50。按笔 $0.30、固定 $2.00 留下。

```
  借  customer:abc:available:USD             -$120.00
  贷  receivable:txn:USD                     -$120.00

  借  revenue:fee:acquiring:USD              -$1.65
  贷  customer:abc:available:USD             +$1.65

  借  customer:abc:reserve:rolling:USD       -$5.50
  贷  customer:abc:available:USD             +$5.50
```

available 净变动 -$112.85。原结算净额只入了 $100.55，不足部分记 USD available 负余额。EUR 钱包不动。

### 5. VOID（CAPTURE 后、SETTLED 前）

冲例 2 原分录，汇率仍为 `booking_fx_rate` 1.10，不是即期。

```
  借  customer:abc:available:USD             -$100.55
  借  customer:abc:reserve:rolling:USD       -$5.50
  借  customer:abc:reserve:fixed:USD         -$2.00
  借  revenue:fee:acquiring:USD              -$1.65
  借  revenue:fee:per_item:USD               -$0.30
  贷  customer:abc:pending:USD               +$110.00

  借  customer:abc:pending:USD               -$110.00
  贷  receivable:txn:USD                     -$110.00
```

（若清分已不经过 pending，则按实际入账账户反向；原则是按原入账汇率全额冲回，含按笔费与固定保证金。）

### 6. 结算币种 ≠ 主币种时的固定保证金

请款与结算均为 EUR（已开通），主币种 USD，入账汇率 1.10（EUR→USD）。入账 €100。MDR €1.50。按笔费标价 $0.30 → 扣 `available:EUR` €0.27（不扣 USD 账户）。滚动 €5.00。固定应抽 $2.00 → 从剩余 EUR 扣 €1.82 换入 `reserve:fixed:USD`。

```
  借  customer:abc:pending:EUR               -€100.00
  贷  customer:abc:available:EUR             +€91.41
  贷  customer:abc:reserve:rolling:EUR       +€5.00
  贷  revenue:fee:acquiring:EUR              +€1.50
  贷  revenue:fee:per_item:EUR               +€0.27
  贷  clearing:fx:EUR_USD                    +€1.82

  借  clearing:fx:EUR_USD                    +$2.00
  贷  customer:abc:reserve:fixed:USD         +$2.00
```

退款不冲固定保证金，也不把 USD 固定兑回 EUR。

## 与既有 ADR

- ADR 0001：资金来源、负余额、滚动 HELD 才退、固定不退 — 仍有效。金额改用请款校验、即期入账，滚动按请款比例。
- ADR 0002：扣除顺序仍是 MDR → 滚动 → 固定。百分比基数改为入账金额；固定目标在主币种。
- ADR 0003：费率锁在 CAPTURE 日、退款仅 SETTLED 后、MDR 退 / 按笔费不退 — 仍有效。跨币种折算见本文。
