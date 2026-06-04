# 0002 保证金机制设计

支持固定保证金（Fixed Reserve）和滚动保证金（Rolling Reserve）两种模式，由商户风险等级决定使用哪种。

## 决策 1：两种保证金模式并存

### 固定保证金（Fixed Reserve）

每笔交易冻结固定比例，90 天后**一次性全额释放**。

```
T+7   交易 $100 结算 → reserve += $5 (5%)
T+97  释放 → reserve -= $5, available += $5
```

适用：低风险商户、新商户（过渡期）

### 滚动保证金（Rolling Reserve）

每笔交易冻结固定比例，**超过窗口期后逐笔释放**，reserve 余额持续存在。

```
Day 1:   交易 $100 结算 → reserve += $5
Day 2:   交易 $200 结算 → reserve += $10 (累计 $15)
Day 91:  释放 Day 1 的 $5 → reserve = $10
Day 92:  释放 Day 2 的 $10 → reserve = ...
```

适用：高风险商户、历史有争议记录的商户

## 决策 2：两种模式共享同一记账逻辑

无论固定还是滚动，**冻结和退款时的记账分录完全相同**，差异仅在释放时机。

```
── 结算时冻结 ────────────────────────────────────────

  借  customer:{id}:pending:{ccy}    -$100
  贷  customer:{id}:available:{ccy}  +$94
  贷  customer:{id}:reserve:{ccy}    +$5      ← 冻结
  贷  revenue:fee:acquiring           +$1

── 退款时退回（两种模式相同）─────────────────────────

  借  customer:{id}:reserve:{ccy}    -$1.50   ← 退回
  贷  customer:{id}:available:{ccy}  +$1.50

── 释放时（唯一差异）────────────────────────────────

固定: T+97 一次性释放全部
  借  customer:{id}:reserve:{ccy}    -$3.50
  贷  customer:{id}:available:{ccy}  +$3.50

滚动: 每天释放 90 天前的那笔
  借  customer:{id}:reserve:{ccy}    -$5.00
  贷  customer:{id}:available:{ccy}  +$5.00
```

## 决策 3：滚动保证金的释放调度

滚动保证金需要逐笔跟踪释放时间。推荐方案：**每笔结算生成一条 reserve entry，附带 release_date**。

```
reserve_entries 表:

  entry_id        | customer_id | currency | amount | release_date | status
  ────────────────┼─────────────┼──────────┼────────┼──────────────┼────────
  RSV-20260601-01 | abc         | USD      | 5.00   | 2026-08-30   | HELD
  RSV-20260602-01 | abc         | USD      | 10.00  | 2026-08-31   | HELD
  RSV-20260603-01 | abc         | USD      | 3.00   | 2026-09-01   | HELD

每日定时任务:
  SELECT * FROM reserve_entries
  WHERE release_date <= TODAY AND status = 'HELD'

  对每条记录:
    借  customer:{id}:reserve:{ccy}    -amount
    贷  customer:{id}:available:{ccy}  +amount
    更新 status = 'RELEASED'
```

## 保证金选择规则

```
IF 商户风险等级 == HIGH OR 历史拒付率 > 阈值
  → 滚动保证金（rolling_reserve_rate = 10%, window = 180 天）

ELSE IF 商户是新商户（开户 < 90 天）
  → 固定保证金（fixed_reserve_rate = 5%, period = 90 天）

ELSE
  → 固定保证金（fixed_reserve_rate = 3%, period = 90 天）
```

## 保证金累计与余额管理

### 账户余额

```
customer:{id}:reserve:{ccy}

  余额 = SUM(所有冻结的 reserve entries)
        - SUM(所有已退回的 reserve entries，退款时)
        - SUM(所有已释放的 reserve entries)
```

### 余额更新时机

| 事件 | reserve 变动 | 触发方式 |
|------|-------------|----------|
| 交易结算 | +amount × rate | T+7 结算批次 |
| 退款（已结算交易） | -退款额 × rate | 实时（退款时同步退回） |
| 释放（固定） | -全额 | 定时任务（T+97） |
| 释放（滚动） | -逐笔 | 每日定时任务 |

### 对账

```
每日对账:
  1. 从 reserve_entries 计算理论余额
     理论余额 = SUM(amount) WHERE status = 'HELD'

  2. 读取账户缓存余额
     缓存余额 = customer:{id}:reserve:{ccy}

  3. 比较
     IF 理论余额 != 缓存余额
       → 告警 + 以 reserve_entries 为准修复
```
