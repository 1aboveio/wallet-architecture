# 退款校验规则（Refund Validation Rules）

## 设计原则

退款校验的核心目标：**防止资损**。确保每一笔退款都有对应的资金来源，不会出现平台垫款或商户超额退款的情况。

## 三条核心决策

1. **退款直接扣 pending** — 退款发生时实时扣减待结算余额，商户即时可见
2. **保证金 90 天后全额释放** — 从 T+7 结算日起算，90 天后释放到 available
3. **负余额从后续收入抵扣** — 商户 available 为负时，新收入先抵扣负余额再入账

## 退款校验规则

退款请求进入时，按顺序执行以下校验，**任一失败则拒绝退款**。

### 规则 1：金额校验

```
退款可执行金额 = 原交易金额 - 已退款累计金额

IF requested_refund > 退款可执行金额
  → REJECT "REFUND_EXCEEDS_AVAILABLE"
```

示例：
- 交易 $100，已退 $30 → 最多再退 $70
- 申请退 $50 → ✅ 允许
- 申请退 $80 → ❌ 拒绝

### 规则 2：交易状态校验

```
允许状态: CAPTURED / SETTLED
拒绝状态: VOIDED / REFUNDED_FULL / DISPUTED / PENDING

IF transaction.status NOT IN (CAPTURED, SETTLED)
  → REJECT "INVALID_TRANSACTION_STATUS"
```

### 规则 3：退款窗口校验

```
IF now > transaction.capture_at + REFUND_WINDOW
  → REJECT "REFUND_WINDOW_EXPIRED"

REFUND_WINDOW 建议:
  卡支付:     180 天（卡组织规则）
  平台自定义: 可缩短
```

### 规则 4：商户资金兜底校验

```
商户总资金 = available_balance
          + pending_balance
          + reserve_balance

IF requested_refund > 商户总资金
  → REJECT "INSUFFICIENT_MERCHANT_FUNDS"
```

**注意：** available 可能为负（历史负余额未抵扣完）。负的 available 会减少总资金，天然限制新退款。

### 规则 5：幂等校验

```
IF refund_id 已存在于退款记录
  → 返回已有结果，不重复执行
```

防止：网络重试、商户重复提交。

## 校验规则总览

| # | 规则 | 校验内容 | 失败返回码 |
|---|------|----------|-----------|
| 1 | 金额校验 | 退款 ≤ 原交易金额 - 已退款累计 | REFUND_EXCEEDS_AVAILABLE |
| 2 | 状态校验 | 交易状态为 CAPTURED 或 SETTLED | INVALID_TRANSACTION_STATUS |
| 3 | 窗口校验 | 在退款窗口期内 | REFUND_WINDOW_EXPIRED |
| 4 | 资金校验 | 退款 ≤ 商户总资金 | INSUFFICIENT_MERCHANT_FUNDS |
| 5 | 幂等校验 | refund_id 唯一 | 返回已有结果 |

## 校验通过后的执行逻辑

```
1. 扣减 pending
   借  payable:merchant:pending:USD    -$30
   贷  receivable:txn:USD              -$30

2. 重新计算保证金（T+7 结算时生效）
   保证金 = (原交易金额 - 退款后累计退款) × 5%

3. 记录退款明细
   refund_id / transaction_id / amount / status / created_at
```

## 三道防线

```
            实时                    批量                   持续
        ┌──────────┐           ┌──────────┐          ┌──────────┐
        │ 退款请求时 │           │ T+7 结算时│          │ 结算后监控 │
        │          │           │          │          │          │
        │ 规则 1   │           │ 逐笔清算  │          │ 每日对账  │
        │ 规则 2   │           │ 保证金    │          │ 拒付监控  │
        │ 规则 3   │           │ 重新计算  │          │ 负余额   │
        │ 规则 4   │           │ 兜底校验  │          │ 追缴     │
        │ 规则 5   │           │ available │          │ 余额预警  │
        │          │           │ ≥ 0      │          │ 冻结交易  │
        └──────────┘           └──────────┘          └──────────┘
```

## 负余额生命周期

### 场景：商户提现后发生退款

```
T+0    商户提现 $94 → available = $0
T+3    交易 A 全额退款 $100
         规则 4 校验: 总资金 = $0 + $100(pending) + $0(reserve) = $100 ≥ $100 ✅
         扣减 pending → pending = $0

T+7    交易 A 结算: pending = $0，无结算金额
       商户状态: available = $0, pending = $0, reserve = $0

T+10   交易 B 结算 $94 → 无负余额 → available = $94
```

### 场景：负余额抵扣

```
假设 available = -$6（历史原因）

新交易结算 $94 进入:
  抵扣负余额: -$6 → 归零
  剩余入账:   $94 - $6 = $88
  available = $88

保证金释放 $5 进入:
  无负余额 → 全额入账
  available = $88 + $5 = $93
```

### 场景：资金不足拒绝退款

```
商户状态: available = -$6, pending = $100, reserve = $0

申请退款 $100:
  规则 4: 总资金 = -$6 + $100 + $0 = $94 < $100 ❌
  → REJECT "INSUFFICIENT_MERCHANT_FUNDS"
```

## 保证金释放规则

```
释放条件: T+7 结算日起算，满 90 天
释放方式: 全额释放到 available

T+7   结算 → reserve = $5
T+97  释放 → reserve = $0, available += $5

释放时如有负余额:
  available = available + $5
  如仍为负，继续从后续收入抵扣
```
