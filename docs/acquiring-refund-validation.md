# 退款校验规则（Refund Validation Rules）

以 [ADR 0001](adr/0001-refund-logic.md) / [0004](adr/0004-multi-currency-clearing.md) 为准。分录见 [journals/acquiring.md](journals/acquiring.md)。

## 设计原则

退款校验的核心目标：**防止资损**。确保每一笔退款都有对应的资金来源，不会出现平台垫款或商户超额退款的情况。

## 核心决策

见 [ADR 0001 退款逻辑设计](adr/0001-refund-logic.md)。

1. **覆盖口径不含保证金** — reserve 不参与可退款资金；可含 pending 与主币种 available 折算（ADR 0001）
2. **只退滚动 HELD** — 按请款比例；固定保证金不退；已释放/已升级不退
3. **资金不足不拒绝** — 实扣结算 available，不足扣主币种，再不足主币种为负

## 退款记账规则

```
退款来源 = 原交易状态决定

Case 1: 原交易已结算（SETTLED）
  来源: available（允许负余额）
  校验: 退款请款金额 ≤ 原请款金额 - 已退请款累计
  实扣: available:{S} → available:{primary}（ADR 0001）

  借  customer:{id}:available:{S}          -退款入账金额（即期）
  贷  receivable:txn:{S}                   -退款入账金额

  MDR 按请款比例退回；滚动 HELD 按请款比例退回 available:{S}
```

## 退款校验规则

退款请求进入时，按顺序执行以下校验，**任一失败则拒绝退款**。

### 规则 1：金额校验

```
退款可执行金额 = 原请款金额 - 已退请款累计

IF refund_presentment_amount > 退款可执行金额
  → REJECT "REFUND_EXCEEDS_AVAILABLE"
```

示例：
- 交易 $100，已退 $30 → 最多再退 $70
- 申请退 $50 → ✅ 允许
- 申请退 $80 → ❌ 拒绝

### 规则 2：交易状态校验

```
允许状态: SETTLED
拒绝状态: CAPTURED / VOIDED / REFUNDED_FULL / DISPUTED / PENDING

IF transaction.status != SETTLED
  → REJECT "INVALID_TRANSACTION_STATUS"
```

**注：** settlement 前的撤销走 VOIDED，不走退款流程。详见 [ADR 0003 交易状态模型](adr/0003-transaction-status-model.md)。

### 规则 3：退款窗口校验

```
IF now > transaction.capture_at + REFUND_WINDOW
  → REJECT "REFUND_WINDOW_EXPIRED"

REFUND_WINDOW 建议:
  卡支付:     180 天（卡组织规则）
  平台自定义: 可缩短
```

### 规则 4：商户资金（不拒绝）

```
可退款资金 = available:{S} + pending:{S}
           + (S ≠ primary ? available:{primary} 折成 S : 0)
不含 reserve

实扣顺序:
  1. available:{S} 扣到 0
  2. 缺口扣 available:{primary}（refund_fx_rate）
  3. 仍不足 → available:{primary} 为负，不 REJECT
```

pending 只进覆盖、不进实扣。详见 ADR 0001 / 0004。

### 规则 5：幂等校验

```
IF refund_id 已存在于退款记录
  → 返回已有结果，不重复执行
```

防止：网络重试、商户重复提交。

## 校验规则总览

| # | 规则 | 校验内容 | 失败返回码 |
|---|------|----------|-----------|
| 1 | 金额校验 | 退款请款 ≤ 原请款 − 已退请款 | REFUND_EXCEEDS_AVAILABLE |
| 2 | 状态校验 | 交易状态为 SETTLED | INVALID_TRANSACTION_STATUS |
| 3 | 窗口校验 | 在退款窗口期内 | REFUND_WINDOW_EXPIRED |
| 4 | 资金 | 覆盖口径见 ADR 0001；不足走主币种兜底/负余额，不拒绝 | — |
| 5 | 幂等校验 | refund_id 唯一 | 返回已有结果 |

## 三道防线

```
            实时                    批量                   持续
        ┌──────────┐           ┌──────────┐          ┌──────────┐
        │ 退款请求时 │           │ T+7 结算时│          │ 结算后监控 │
        │          │           │          │          │          │
        │ 规则 1   │           │ 逐笔清算  │          │ 每日对账  │
        │ 规则 2   │           │ 保证金    │          │ 拒付监控  │
        │ 规则 3   │           │ 重新计算  │          │ 负余额   │
        │ 规则 4   │           │ 不拒退款  │          │ 追缴     │
        │ 规则 5   │           │ 负余额   │          │ 余额预警  │
        │          │           │ 同币种冲  │          │ 冻结交易  │
        └──────────┘           └──────────┘          └──────────┘
```

## 负余额生命周期

### 场景：商户提现后发生退款

```
T+0    商户提现 $94 → available = $0
T+7    交易 A 结算 $100 → available = $100
         商户再次提现 $100 → available = $0
T+10   交易 A 全额退款 $100（已结算）
         退款来源: available（允许负余额）
         available = $0 - $100 = -$100

T+17   交易 B 结算 $94 → 先冲负余额 -$100 → 实际入账 -$6
         available = -$100 + $94 = -$6
T+24   交易 C 结算 $200 → 先冲负余额 -$6 → 实际入账 $194
         available = -$6 + $200 = $194
```

### 场景：已结算交易退款产生负余额

```
原交易 $100，已结算（T+7），保证金 $5
商户在 T+8 提现 $94 → available = $0
T+10 发起退款 $30

退款来源: available（已结算）
  借  customer:abc:available:USD   -$30.00
  贷  receivable:txn:USD           +$30.00

  借  customer:abc:reserve:rolling:USD  -$1.50
  贷  customer:abc:available:USD        +$1.50

结果:
  available = $0 - $30 + $1.50 = -$28.50
  reserve:rolling = $5 - $1.50 = $3.50

后续抵扣:
  新交易结算 $94 → 先冲负余额 -$28.50 → 实际入账 $65.50
  保证金释放 $3.50 → 无负余额 → 全额入账
```

### 场景：资金不足但允许退款（负余额）

```
商户状态: available = -$6, reserve = $0

申请退款（原交易已结算）$100:
  退款来源: available（允许负余额）
  不拒绝 → available = -$6 - $100 = -$106
  后续收入自动抵扣

说明: 退款只能在 SETTLED 之后发起，不存在从 pending 退款的场景。
      settlement 前的撤销走 VOIDED 流程，不涉及商户资金。
```

## 保证金释放规则

```
滚动: 按 entry 的 release_date 释放到 available:{settlement_currency}
      释放时先冲同币种负 available（ADR 0001）
固定: 手动释放到 available:{primary_currency}，退款不自动退
```
