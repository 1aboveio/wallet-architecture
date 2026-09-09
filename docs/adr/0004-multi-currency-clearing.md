# 0004 多币种清分与退款汇率

下游按请款 / 入账 / 结算 / 主币种分账。CAPTURE 按当时牌价换汇入账（入账汇率）；退款商户侧用即期（有通道价则跟通道）。汇差由商户承担，平台不对退款做 FX 自营。入账汇率不是锁汇。

术语见 [CONTEXT.md](../../CONTEXT.md)。分录见 [journals/acquiring.md](../journals/acquiring.md)。

## 核心原则

1. **四币分离。** 请款币种、该笔结算币种、主币种、上游结算币种各自记账，互不重算。
2. **CAPTURE 换汇入账。** `booking_amount = presentment_amount × booking_fx_rate`（同币种汇率为 1）。这是入账时的一次换汇，不是锁汇。VOID 冲原换汇分录，仍用这笔入账汇率。
3. **标价币与扣账币可以不同；扣账跟该笔结算钱包。** MDR 按请款金额计价，扣结算币种；按笔费按主币种**标价**，用入账汇率折成结算币种后从**该笔结算钱包**扣，不另扣主币种钱包；滚动留结算币种；固定目标在主币种。滚动升级为固定只允许主币种同币直转（ADR 0002）。
4. **上游成本只收录。** interchange / scheme / 通道费以结算文件的固定额记入 `channel_settlement_currency`，不按 IRF 表重算，也不编进商户净额。
5. **退款汇率用即期。** 买家退原请款金额；商户扣 `refund_booking_amount = refund_presentment_amount × refund_fx_rate`。`refund_fx_rate` 优先用通道该笔退款汇率，否则用退款时牌价。不用 `booking_fx_rate`。
6. **VOID 冲原入账汇率。** 未 SETTLED 的撤销是原分录反向，不是一笔新的 FX。
7. **滚动退回按请款比例。** `rolling_return = refund_presentment_amount / presentment_amount × original_rolling_reserve`，币种仍是原结算币种。不用入账即期比例。
8. **退款实扣结算钱包，不足扣主币种。** 不扣 pending / reserve。缺口用 `fallback_fx_rate`（结算币种→主币种）从 `available:{primary}` 扣，仍不足则主币种为负。负余额只被同币种后续收入冲抵（ADR 0001）。

### 为何不叫锁汇

CAPTURE 换汇只决定当时怎么把请款金额写成入账金额。退款买家必须拿回原请款金额，平台按即期备请款币；若商户仍按入账汇率扣，汇差在平台。故退款用即期，入账汇率不作双向保证。

### 按笔费：标价主币种，扣该笔结算钱包

合同写 `$0.10`（主币种），不等于从 USD 账户扣 $0.10。

请款 EUR、结算 EUR、主币种 USD、入账汇率 1.10：

| 做法 | 分录 | 结论 |
|---|---|---|
| **采用：折成结算币种扣** | CAPTURE 时从 **pending:EUR** 扣 €0.09，收入记 EUR | 和这笔资金同一条腿；EUR-only 商户不必先有 USD |
| 不用：扣主币种钱包 | `available:USD -$0.10` | USD 没余额就变负；退款不退按笔费时 USD 缺口一直在 |

退款手续费同一规则：主币种标价，扣该笔结算钱包。

## 扣款顺序（CAPTURE）

```
请款金额 × booking_fx_rate → 入账金额（settlement_currency）
  → MDR（请款金额 × 费率，折结算币种）
  → 按笔费（主币种标价，折结算币种，扣结算钱包）
  → 滚动保证金（入账金额 × 比率，settlement_currency）
  → 固定保证金（折主币种，受目标差额与剩余封顶）
  → 结算净额 → pending:{settlement_currency}（不可提现）
SETTLED：pending 净额 → available:{settlement_currency}
```

结算币种 = 请款币种 ∈ 开通集 ? 请款币种 : 主币种。

## 退款时处理

| 项 | 退不退 | 金额 |
|---|---|---|
| 买家 | 退 | 退款请款金额（请款币种） |
| 商户 available | 扣 | 退款入账金额（即期）；先结算钱包再主币种 |
| MDR | 按请款比例退 | 原 MDR × 退款请款 / 原请款 |
| 按笔费 | 不退 | — |
| 滚动 HELD | 按请款比例退 | 见原则 7 |
| 滚动已释放 / 已升级 | 不退 | — |
| 固定保证金 | 不退 | — |
| 退款手续费 | 另扣 | 主币种标价，折该笔结算币种 |
| 上游 IC / scheme | 通道给多少记多少 | `channel_settlement_currency` |

校验：`refund_presentment_amount` 累计 ≤ 原请款金额。尾笔请款侧吃分位；入账侧不强制加总还原入账金额。

分录见 [journals/acquiring.md](../journals/acquiring.md)。

## 与既有 ADR

- ADR 0001：覆盖口径含 pending + 主币种 fallback；实扣 available:S 再 available:primary；reserve 不参与。滚动 HELD 才退、固定不退。
- ADR 0002：扣除顺序 MDR → 按笔费 → 滚动 → 固定。百分比基数为入账金额；固定目标在主币种；升级仅 primary 同币直转。
- ADR 0003：费率锁在 CAPTURE 日、退款仅 SETTLED 后、MDR 退 / 按笔费不退 — 仍有效。跨币种折算见本文。
