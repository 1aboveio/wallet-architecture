# 0001 退款逻辑设计

退款场景下的核心决策，涉及资金来源、保证金处理和负余额策略。多币种见 [ADR 0004](0004-multi-currency-clearing.md)。分录见 [journals/acquiring.md](../journals/acquiring.md)。

## 决策 1：退款可用资金不包含保证金，主币种作 fallback

覆盖口径（该笔结算币种 S 计）不含 reserve。结算钱包不够时，把主币种 available 按 **兜底汇率** `fallback_fx_rate`（S → primary）折成 S。不要用 `refund_fx_rate`（那是请款 → 结算）。

```
可退款资金 = available:{S} + pending:{S}
           + (S ≠ primary ? available:{primary} / fallback_fx_rate : 0)
S = 该笔 settlement_currency
不含 reserve:fixed / reserve:rolling
```

**覆盖 ≠ 实扣。** pending 只进覆盖、不进实扣（未结资金不能拿来付退款）。实扣见决策 3。

### 理由

1. **防滥用** — 避免商户通过退款将保证金提前取出
2. **专款专用** — 保证金仅用于覆盖争议/拒付，不参与退款
3. **主币种兜底** — 结算钱包不够时先动主币种，而不是一边 EUR 为负、一边 USD 闲置

## 决策 2：已结算交易退款时，滚动保证金同步退回，固定保证金不退回

已结算交易发起退款时：
- **滚动保证金**：按**请款金额**比例同步退回商户可用余额，与退款在同一事务内完成（`refund_presentment_amount / presentment_amount × original_rolling_reserve`）
- **固定保证金**：不退回（固定保证金是全局目标金额，与单笔交易无关）
- **MDR**：按请款比例退回（ADR 0003）
- **按笔费**：不退

## 决策 3：实扣结算钱包，不足扣主币种，再不足允许负余额

退款请款校验通过后必须执行。实扣顺序：

```
1. available:{S} 扣到 0（不扣 pending、不扣 reserve）
2. 缺口按 fallback_fx_rate（S→primary）从 available:{primary} 扣
3. 主币种仍不足：允许 available:{primary} 为负
   （S = primary 时即该币种 available 为负）
```

S = primary 时没有第 2 步。滚动保证金退回仍贷 `available:{S}`。

### 负余额抵扣

只冲**同一币种**的后续收入，不自动跨币种：

```
1. 该币种新交易结算净额 → 先抵扣该币种负 available
2. 该币种保证金释放 → 先抵扣该币种负 available
```

---

分录（含滚动 HELD / 已释放 / 固定不退、主币种兜底）见 [journals/acquiring.md](../journals/acquiring.md)。

## 退款校验规则汇总

| Case | 原交易状态 | 保证金类型 | 保证金状态 | 退款来源 | 保证金退回 | 允许负余额 |
|------|-----------|-----------|-----------|---------|-----------|------------|
| 1 | 已结算 | 滚动 | HELD | available | ✅ 按比例 | ✅ |
| 2 | 已结算 | 滚动 | RELEASED / RESERVE_RELEASED | available | ❌ 不退回 | ✅ |
| 3 | 已结算 | 固定 | — | available | ❌ 不退回 | ✅ |

**注：** 退款从 `SETTLED` 或未退完的 `REFUNDED` 发起（ADR 0003）。SETTLED 前撤销走 VOIDED。

## 退款校验规则

```
规则 1: 金额校验
  退款请款金额 ≤ 原请款金额 - 已退请款累计

规则 2: 状态校验
  交易状态为 SETTLED（详见 ADR 0003）

规则 3: 窗口校验
  在退款窗口期内（卡支付 180 天）

规则 4: 资金校验
  允许 available 为负（不拒绝，后续收入自动抵扣）

规则 5: 幂等校验
  refund_id 唯一
```

**说明：** 所有 Case 允许 available 为负余额，不拒绝退款。
