# 0002 保证金机制设计

支持固定保证金（Fixed Reserve）和滚动保证金（Rolling Reserve）两种模式，可同时存在于同一商户。

## 核心规则

1. 每笔交易只扣其中一种保证金（由商户风险等级和配置决定）
2. 两种保证金可以同时存在于同一商户的不同账户
3. 滚动保证金可转为固定保证金（升级），固定保证金不可转滚动保证金（不允许降级）
4. 两种保证金都按交易金额的百分比扣除，百分比可配置

## 账户结构

```
customer:{id}:reserve:fixed:{ccy}     ← 固定保证金
customer:{id}:reserve:rolling:{ccy}   ← 滚动保证金
```

## 固定保证金（Fixed Reserve）

按交易金额百分比扣除，累计到目标金额后停止扣除。释放需手动触发。

### 累计方式（三种，可混合）

**方式 1：从 available 余额一次性扣除**

```
目标: $500, available = $1000

  借  customer:abc:available:USD        -$500.00
  贷  customer:abc:reserve:fixed:USD    +$500.00
```

**方式 2：从每笔结算中按百分比扣除**

```
目标: $500, 已累计: $400, 比率: 5%
交易 $1000 结算

  按百分比应扣 = $1000 × 5% = $50
  目标差额 = $500 - $400 = $100
  实际扣除 = min($50, $100) = $50

  借  customer:abc:pending:USD          -$1,000.00
  贷  customer:abc:available:USD        +$940.00
  贷  customer:abc:reserve:fixed:USD    +$50.00
  贷  revenue:fee:acquiring             +$10.00

  累计: $400 + $50 = $450，差额: $50
```

**方式 3：商户直接充值/打款**

```
目标: $500, 已累计: $200

  借  house:bank:USD                    +$300.00
  贷  customer:abc:reserve:fixed:USD    +$300.00

  累计: $200 + $300 = $500（已满）
```

### 扣除公式

```
每笔结算:
  按百分比应扣 = 结算金额 × 比率
  目标差额 = 目标金额 - 已累计金额
  实际扣除 = min(按百分比应扣, 目标差额)

  IF 目标差额 == 0
    → 不扣保证金，全额入 available
```

### 释放

手动触发（商户关闭账户、风险等级下降等）：

```
  借  customer:abc:reserve:fixed:USD    -$500.00
  贷  customer:abc:available:USD        +$500.00
```

### 退款

固定保证金不因单笔交易退款而调整（是固定金额，与单笔交易无关）。

---

## 滚动保证金（Rolling Reserve）

按交易金额百分比扣除，N 天后自动释放。无目标金额上限。

### 扣除

```
比率: 5%, 释放窗口: 90 天
交易 $1000 结算

  借  customer:abc:pending:USD          -$1,000.00
  贷  customer:abc:available:USD        +$940.00
  贷  customer:abc:reserve:rolling:USD  +$50.00
  贷  revenue:fee:acquiring             +$10.00
```

### 释放

90 天后自动释放，通过定时任务逐条处理：

```
每日定时任务:
  SELECT * FROM reserve_entries
  WHERE type = 'ROLLING'
    AND release_date <= CURRENT_DATE
    AND status = 'HELD'

  对每条:
    借  customer:{id}:reserve:rolling:{ccy}  -amount
    贷  customer:{id}:available:{ccy}        +amount
    UPDATE status = 'RELEASED'
```

### 退款

已结算交易退款时，按退款比例退回滚动保证金：

```
原交易 $100, 滚动保证金 $5 (5%)
退款 $30

  退回金额 = $30/$100 × $5 = $1.50

  借  customer:abc:reserve:rolling:USD  -$1.50
  贷  customer:abc:available:USD        +$1.50
```

---

## 滚动转固定（升级）

商户风险等级下降时，可将滚动保证金余额转入固定保证金：

```
滚动余额: $200
固定目标: $500, 已累计: $250

  借  customer:abc:reserve:rolling:USD  -$200.00
  贷  customer:abc:reserve:fixed:USD    +$200.00

  固定保证金: $250 + $200 = $450（未满，继续从结算扣除）
```

---

## 两种保证金对比

| 维度 | 固定保证金 | 滚动保证金 |
|------|-----------|-----------|
| **扣除方式** | 按交易金额百分比 | 按交易金额百分比 |
| **百分比** | 可配置 | 可配置 |
| **目标金额** | 有上限 | 无上限 |
| **停止扣除** | 达到目标后停止 | 永不停止 |
| **释放** | 手动触发 | N 天后自动释放 |
| **退款退回** | ❌ 不退回 | ✅ 按比例退回 |
| **累计方式** | 余额扣除 / 结算扣除 / 充值 | 仅结算扣除 |
| **账户** | `reserve:fixed:{ccy}` | `reserve:rolling:{ccy}` |

## 保证金选择规则

```
IF 商户风险等级 == HIGH OR 历史拒付率 > 阈值
  → 滚动保证金（比率 10%, 窗口 180 天）

ELSE IF 商户是新商户（开户 < 90 天）
  → 固定保证金（目标 $500, 比率 5%）

ELSE
  → 固定保证金（目标 $300, 比率 3%）
```

## 保证金选择规则

```
IF 商户风险等级 == HIGH OR 历史拒付率 > 阈值
  → 滚动保证金（比率 10%, 窗口 180 天）

ELSE IF 商户是新商户（开户 < 90 天）
  → 固定保证金（目标 $500, 比率 5%）

ELSE
  → 固定保证金（目标 $300, 比率 3%）
```
