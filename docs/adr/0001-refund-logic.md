# 0001 退款逻辑设计

退款场景下的核心决策，涉及资金来源、保证金处理和负余额策略。

## 决策 1：退款可用资金不包含保证金

退款校验时，商户可退款资金仅包含 `available_balance` 和 `pending_balance`，不包含 `reserve_balance`（固定或滚动）。

```
商户可退款资金 = available_balance + pending_balance
```

### 理由

1. **防滥用** — 避免商户通过退款将保证金提前取出
2. **防负余额** — 保证金被退款消耗后，可能产生大面积负余额
3. **专款专用** — 保证金仅用于覆盖争议/拒付，不参与退款

## 决策 2：已结算交易退款时，滚动保证金同步退回，固定保证金不退回

已结算交易发起退款时：
- **滚动保证金**：按退款比例同步退回商户可用余额，与退款在同一事务内完成
- **固定保证金**：不退回（固定保证金是全局目标金额，与单笔交易无关）

## 决策 3：允许退款产生负余额

已结算交易发起退款时，如果商户 `available_balance` 不足，允许退款并产生负余额，后续从新收入中自动抵扣。

### 负余额抵扣机制

后续收入自动冲抵负余额，优先级：

```
1. 新交易结算 → 先抵扣负余额，剩余入 available
2. 保证金释放 → 先抵扣负余额，剩余入 available
```

---

## 退款记账规则

退款来源由**原交易状态**和**原交易适用的保证金类型**共同决定。

### Case 1：原交易待结算

```
来源: pending
校验: 退款金额 ≤ 原交易金额 - 已退款累计
保证金: 无（尚未结算，保证金未冻结）

  借  customer:{id}:pending:{ccy}    -退款金额
  贷  receivable:txn:{ccy}           -退款金额
```

### Case 2：原交易已结算 + 滚动保证金（状态 HELD）

```
来源: available（允许负余额）
校验: 退款金额 ≤ 原交易金额 - 已退款累计
保证金: 按退款比例退回滚动保证金（仅 HELD 状态）

  退款:
  借  customer:{id}:available:{ccy}        -退款金额
  贷  receivable:txn:{ccy}                 -退款金额

  滚动保证金退回 = 退款金额/原交易金额 × 原滚动保证金:
  借  customer:{id}:reserve:rolling:{ccy}  -退回金额
  贷  customer:{id}:available:{ccy}        +退回金额
```

示例：
```
原交易 $100，滚动保证金 $5 (5%)，状态 HELD，退款 $30

  退回金额 = $30/$100 × $5 = $1.50

  借  customer:abc:available:USD        -$30.00
  贷  receivable:txn:USD                +$30.00

  借  customer:abc:reserve:rolling:USD  -$1.50
  贷  customer:abc:available:USD        +$1.50

  净效果: available -$28.50, rolling_reserve -$1.50
```

### Case 2b：原交易已结算 + 滚动保证金（状态 RELEASED 或 RESERVE_RELEASED）

```
来源: available（允许负余额）
校验: 退款金额 ≤ 原交易金额 - 已退款累计
保证金: 不退回（已释放或已升级，不在 rolling 中）

  借  customer:{id}:available:{ccy}    -退款金额
  贷  receivable:txn:{ccy}             -退款金额
```

示例：
```
原交易 $100，滚动保证金 $5 (5%)，状态 RELEASED，退款 $30

  借  customer:abc:available:USD        -$30.00
  贷  receivable:txn:USD                +$30.00

  保证金已释放，不退回
  净效果: available -$30.00
```

### Case 3：原交易已结算 + 固定保证金

```
来源: available（允许负余额）
校验: 退款金额 ≤ 原交易金额 - 已退款累计
保证金: 不退回（固定保证金是全局目标，与单笔交易无关）

  借  customer:{id}:available:{ccy}    -退款金额
  贷  receivable:txn:{ccy}             -退款金额
```

示例：
```
原交易 $100，固定保证金（全局目标 $500），退款 $30

  借  customer:abc:available:USD        -$30.00
  贷  receivable:txn:USD                +$30.00

  固定保证金: 不调整

  净效果: available -$30.00
```

---

## 退款校验规则汇总

| Case | 原交易状态 | 保证金类型 | 保证金状态 | 退款来源 | 保证金退回 | 允许负余额 |
|------|-----------|-----------|-----------|---------|-----------|------------|
| 1 | 待结算 | — | — | pending | 无 | N/A |
| 2 | 已结算 | 滚动 | HELD | available | ✅ 按比例 | ✅ |
| 2b | 已结算 | 滚动 | RELEASED / RESERVE_RELEASED | available | ❌ 不退回 | ✅ |
| 3 | 已结算 | 固定 | — | available | ❌ 不退回 | ✅ |

## 退款校验规则

```
规则 1: 金额校验
  退款金额 ≤ 原交易金额 - 已退款累计

规则 2: 状态校验
  交易状态为 CAPTURED 或 SETTLED

规则 3: 窗口校验
  在退款窗口期内（卡支付 180 天）

规则 4: 资金校验（仅 Case 1）
  退款金额 ≤ pending_balance

规则 5: 幂等校验
  refund_id 唯一
```

**Case 2 和 Case 3 不拒绝 available 不足（允许负余额）。**
