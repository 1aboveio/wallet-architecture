# 退款校验规则（Refund Validation Rules）

## 设计原则

退款校验的核心目标：**防止资损**。确保每一笔退款都有对应的资金来源，不会出现平台垫款或商户超额退款的情况。

## 核心决策

见 [ADR 0001 退款逻辑设计](adr/0001-refund-logic.md)。

1. **退款可用资金不包含保证金** — reserve 仅用于覆盖争议/拒付，不参与退款
2. **已结算退款时保证金同步退回** — 退款与保证金退还在同一事务内完成
3. **允许退款产生负余额** — available 不足时不拒绝退款，后续收入自动抵扣

## 退款记账规则

```
退款来源 = 原交易状态决定

Case 1: 原交易待结算（T+0 ~ T+7）
  来源: pending
  校验: 退款金额 ≤ 原交易金额 - 已退款累计

  借  customer:{id}:pending:{ccy}    -退款金额
  贷  receivable:txn:{ccy}           -退款金额

Case 2: 原交易已结算（T+7 之后）
  来源: available（允许负余额）
  校验: 退款金额 ≤ 原交易金额 - 已退款累计

  借  customer:{id}:available:{ccy}  -退款金额
  贷  receivable:txn:{ccy}           -退款金额

  同时退回保证金:
  借  customer:{id}:reserve:{ccy}    -退回金额
  贷  customer:{id}:available:{ccy}  +退回金额
```

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
商户可退款资金 = available_balance
              + pending_balance

IF requested_refund > 商户可退款资金
  → REJECT "INSUFFICIENT_MERCHANT_FUNDS"
```

**注意：** reserve_balance 不参与退款可用资金计算（见 ADR 0001）。available 可能为负（历史负余额未抵扣完），负的 available 会减少可退款资金。

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
| 4 | 资金校验 | 退款 ≤ 商户可退款资金（available + pending，不含 reserve） | INSUFFICIENT_MERCHANT_FUNDS |
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
        │ 规则 4   │           │ 兜底校验  │          │ 追缴     │
        │ 规则 5   │           │ available │          │ 余额预警  │
        │          │           │ ≥ 0      │          │ 冻结交易  │
        └──────────┘           └──────────┘          └──────────┘
```

## 负余额生命周期

### 场景：商户提现后发生退款

```
T+0    商户提现 $94 → available = $0
T+3    交易 A 全额退款 $100（原交易待结算）
         退款来源: pending
         pending = $100 ≥ $100 ✅
         扣减 pending → pending = $0

T+7    交易 A 结算: pending = $0，无结算金额
       商户状态: available = $0, pending = $0, reserve = $0

T+10   交易 B 结算 $94 → 无负余额 → available = $94
```

### 场景：已结算交易退款产生负余额

```
原交易 $100，已结算（T+7），保证金 $5
商户在 T+8 提现 $94 → available = $0
T+10 发起退款 $30

退款来源: available（已结算）
  借  customer:abc:available:USD   -$30.00
  贷  receivable:txn:USD           +$30.00

  借  customer:abc:reserve:USD     -$1.50
  贷  customer:abc:available:USD   +$1.50

结果:
  available = $0 - $30 + $1.50 = -$28.50
  reserve   = $5 - $1.50 = $3.50

后续抵扣:
  新交易结算 $94 → 先冲负余额 -$28.50 → 实际入账 $65.50
  保证金释放 $3.50 → 无负余额 → 全额入账
```

### 场景：资金不足拒绝退款

```
商户状态: available = -$6, pending = $100, reserve = $0

申请退款（原交易待结算）$100:
  退款来源: pending
  pending = $100 ≥ $100 ✅ → 允许

申请退款（原交易已结算）$100:
  退款来源: available（允许负余额）
  不拒绝 → available = -$6 - $100 = -$106
  后续收入自动抵扣
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
