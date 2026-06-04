# 0002 保证金机制设计

支持固定保证金（Fixed Reserve）和滚动保证金（Rolling Reserve）两种模式，可同时存在于同一商户，同一笔交易可同时扣两种。

## 核心规则

1. 每笔交易可以同时扣固定保证金**和/或**滚动保证金
2. 两种保证金可以同时存在于同一商户的不同账户
3. 滚动保证金可**升级**为固定保证金，固定保证金不可降级为滚动保证金
4. 两种保证金都按**原单金额的百分比**扣除，百分比可配置
5. 固定保证金：如果扣除手续费后剩余余额不足，按剩余金额全额扣
   滚动保证金：如果扣除手续费后剩余余额不足，按原单百分比扣除，可能导致结算余额为负
6. 保证金比率与 MDR 独立配置，不做交叉校验
7. 扣除顺序：MDR → 滚动保证金 → 固定保证金

## 账户结构

```
customer:{id}:reserve:fixed:{ccy}       ← 固定保证金
customer:{id}:reserve:rolling:{ccy}     ← 滚动保证金
customer:{id}:special_account:{ccy}     ← 充值专户（用于固定保证金充值）
```

---

## 扣除逻辑

### 扣除顺序

```
原单金额 → 扣 MDR → 扣滚动保证金 → 扣固定保证金 → 商户实收
```

### 固定保证金扣除逻辑

```
按百分比应扣 = 原单金额 × 固定保证金比率
剩余余额 = 原单金额 - MDR - 已扣固定保证金
实际扣除 = min(按百分比应扣, 剩余余额)

IF 剩余余额 <= 0
  → 不扣固定保证金
```

特点：**封顶保护**，不会导致商户结算余额为负。

### 滚动保证金扣除逻辑

```
按百分比应扣 = 原单金额 × 滚动保证金比率
实际扣除 = 按百分比应扣（不封顶）

IF 扣除后结算余额为负
  → 允许，记入 available 负余额
```

特点：**不封顶**，优先保障保证金覆盖，可能导致结算余额为负。

---

## 示例

### 示例 1：正常情况（两种保证金同时扣）

```
原单 $100, MDR 1%, 滚动保证金 5%, 固定保证金 3%

  MDR = $100 × 1% = $1.00
  滚动保证金 = $100 × 5% = $5.00
  固定保证金 = $100 × 3% = $3.00
  商户实收 = $100 - $1 - $5 - $3 = $91.00

  借  customer:abc:pending:USD          -$100.00
  贷  customer:abc:available:USD        +$91.00
  贷  customer:abc:reserve:rolling:USD  +$5.00
  贷  customer:abc:reserve:fixed:USD    +$3.00
  贷  revenue:fee:acquiring             +$1.00
```

### 示例 2：固定保证金封顶（剩余不足）

```
原单 $100, MDR 10%, 滚动保证金 5%, 固定保证金 95%

  MDR = $100 × 10% = $10.00
  滚动保证金 = $100 × 5% = $5.00
  剩余 = $100 - $10 - $5 = $85
  固定保证金应扣 = $100 × 95% = $95
  固定保证金实际 = min($95, $85) = $85（封顶）
  商户实收 = $100 - $10 - $5 - $85 = $0.00

  借  customer:abc:pending:USD          -$100.00
  贷  customer:abc:available:USD        +$0.00
  贷  customer:abc:reserve:rolling:USD  +$5.00
  贷  customer:abc:reserve:fixed:USD    +$85.00
  贷  revenue:fee:acquiring             +$10.00
```

### 示例 3：仅滚动保证金（高风险商户）

```
原单 $100, MDR 1%, 滚动保证金 95%

  MDR = $100 × 1% = $1.00
  滚动保证金 = $100 × 95% = $95.00
  商户实收 = $100 - $1 - $95 = $4.00

  借  customer:abc:pending:USD          -$100.00
  贷  customer:abc:available:USD        +$4.00
  贷  customer:abc:reserve:rolling:USD  +$95.00
  贷  revenue:fee:acquiring             +$1.00
```

### 示例 4：仅固定保证金（低风险商户）

```
原单 $100, MDR 1%, 固定保证金 5%, 目标 $500, 已累计 $480

  MDR = $100 × 1% = $1.00
  固定保证金应扣 = $100 × 5% = $5.00
  目标差额 = $500 - $480 = $20
  固定保证金实际 = min($5, $20) = $5.00
  商户实收 = $100 - $1 - $5 = $94.00

  借  customer:abc:pending:USD          -$100.00
  贷  customer:abc:available:USD        +$94.00
  贷  customer:abc:reserve:fixed:USD    +$5.00
  贷  revenue:fee:acquiring             +$1.00
```

---

## 固定保证金（Fixed Reserve）

按原单金额百分比扣除，累计到目标金额后停止扣除。释放需手动触发。

### 操作与资金路径

| 操作 | 资金路径 | 触发方式 |
|------|----------|----------|
| 累计（结算扣除） | `pending → fixed_reserve` | 每笔结算自动 |
| 累计（充值） | `special_account → fixed_reserve` | 商户主动充值 |
| 释放 | `fixed_reserve → available_balance` | 手动触发 |

### 累计方式 1：从结算中扣除

```
目标: $500, 已累计: $400, 比率: 5%
交易 $1000 结算, MDR 1%

  按百分比应扣 = $1000 × 5% = $50
  目标差额 = $500 - $400 = $100
  实际扣除 = min($50, $100) = $50
  MDR = $1000 × 1% = $10

  借  customer:abc:pending:USD          -$1,000.00
  贷  customer:abc:available:USD        +$940.00
  贷  customer:abc:reserve:fixed:USD    +$50.00
  贷  revenue:fee:acquiring             +$10.00
```

### 累计方式 2：从充值专户转入

```
目标: $500, 已累计: $200

  借  customer:abc:special_account:USD  -$300.00
  贷  customer:abc:reserve:fixed:USD    +$300.00
```

### 扣除公式

```
每笔结算:
  按百分比应扣 = 原单金额 × 比率
  目标差额 = 目标金额 - 已累计金额
  剩余余额 = 原单金额 - MDR
  实际扣除 = min(按百分比应扣, 目标差额, 剩余余额)

  IF 目标差额 == 0
    → 不扣固定保证金
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

按原单金额百分比扣除，N 天后自动释放。无目标金额上限。

### 操作与资金路径

| 操作 | 资金路径 | 触发方式 |
|------|----------|----------|
| 累计 | `pending → rolling_reserve` | 每笔结算自动 |
| 释放 | `rolling_reserve → available_balance` | N 天后定时任务自动 |
| 升级 | `rolling_reserve → fixed_reserve` | 手动触发（全额） |

### 累计

```
比率: 5%, 释放窗口: 90 天
交易 $1000 结算, MDR 1%

  保证金 = $1000 × 5% = $50
  MDR = $1000 × 1% = $10

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

### 升级（升级为固定保证金）

商户风险等级下降时，可将滚动保证金**全额**升级为固定保证金。

**约束条件：**
- 必须全额升级，不允许部分升级
- 升级后，原滚动保证金 entries 状态改为 `RESERVE_RELEASED`
- 资金路径：直接 `rolling → fixed`，不经过 available

```
滚动余额: $200（全额升级）
固定目标: $500, 已累计: $250

  借  customer:abc:reserve:rolling:USD  -$200.00
  贷  customer:abc:reserve:fixed:USD    +$200.00

  固定保证金: $250 + $200 = $450（未满，继续从结算扣除）

  entries 状态更新:
    rolling entries → RESERVE_RELEASED
```

**为什么不经过 available：**
- available 是商户可用余额，经过 available 会产生"假可用"的中间状态
- 直接转是原子操作，不存在并发问题
- 语义清晰：升级是"保证金搬家"，不是"释放再冻结"

### 退款

已结算交易退款时，按退款比例退回滚动保证金。

**约束条件：只有保证金状态为 `HELD` 的交易才能退回保证金。**

```
原交易 $100, 滚动保证金 $5 (5%), 状态 HELD
退款 $30

  退回金额 = $30/$100 × $5 = $1.50

  借  customer:abc:reserve:rolling:USD  -$1.50
  贷  customer:abc:available:USD        +$1.50
```

```
原交易 $100, 滚动保证金 $5 (5%), 状态 RELEASED（已释放）
退款 $30

  保证金已释放，不在 rolling 中，不退回

  借  customer:abc:available:USD        -$30.00
  贷  receivable:txn:USD                +$30.00
```

```
原交易 $100, 滚动保证金 $5 (5%), 状态 RESERVE_RELEASED（已升级）
退款 $30

  保证金已升级到 fixed，不从 fixed 退回

  借  customer:abc:available:USD        -$30.00
  贷  receivable:txn:USD                +$30.00
```

---

## 资金路径汇总

```
                    ┌─────────────────────────────────────────┐
                    │            固定保证金                    │
                    │                                         │
  ┌─────────┐      │      ┌──────────────────┐              │
  │ pending  │──────┼─────▶│  reserve:fixed   │              │
  └─────────┘      │      └────────┬─────────┘              │
                    │               │                        │
  ┌─────────┐      │               │ 释放                   │
  │ special  │──────┼─────▶        ▼                        │
  │ account  │      │      ┌──────────────────┐              │
  └─────────┘      │      │  available       │              │
                    │      └──────────────────┘              │
                    └─────────────────────────────────────────┘

                    ┌─────────────────────────────────────────┐
                    │            滚动保证金                    │
                    │                                         │
  ┌─────────┐      │      ┌──────────────────┐              │
  │ pending  │──────┼─────▶│  reserve:rolling │              │
  └─────────┘      │      └───┬─────────┬────┘              │
                    │          │         │                   │
                    │          │ 释放    │ 升级（全额）        │
                    │          ▼         ▼                   │
                    │      ┌────────┐ ┌──────────────┐       │
                    │      │available│ │ reserve:fixed │       │
                    │      └────────┘ └──────────────┘       │
                    └─────────────────────────────────────────┘
```

---

## 两种保证金对比

| 维度 | 固定保证金 | 滚动保证金 |
|------|-----------|-----------|
| **扣除方式** | 按原单金额百分比 | 按原单金额百分比 |
| **百分比** | 可配置 | 可配置 |
| **目标金额** | 有上限 | 无上限 |
| **停止扣除** | 达到目标后停止 | 永不停止 |
| **余额不足时** | 封顶（按剩余扣） | 不封顶（可能导致负余额） |
| **释放** | 手动触发 | N 天后自动释放 |
| **退款退回** | ❌ 不退回 | ✅ 按比例退回（仅 HELD 状态） |
| **累计路径** | pending→fixed, special→fixed | pending→rolling |
| **释放路径** | fixed→available | rolling→available |
| **升级路径** | — | rolling→fixed（全额，直接转） |
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

## 运行时风控

保证金比率与 MDR 独立配置，不做交叉校验。但需要运行时监控防止负余额失控：

```
规则 1: 连续负余额告警
  IF 商户 available_balance 连续 N 笔交易为负
    → 告警
    → 冻结新交易

规则 2: 负余额上限
  IF 商户 available_balance < -阈值
    → 冻结出金
    → 要求商户补充保证金（充值到 special_account → fixed_reserve）
```
