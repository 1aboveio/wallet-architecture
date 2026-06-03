# 账户体系与余额设计（Account & Balance Design）

## 设计原则

1. **客户 ID 嵌入账户名** — 每个客户有独立账户，物理隔离，不可能串户
2. **冻结是账户不是状态** — 冻结操作有借有贷，账本完整可追溯
3. **缓存余额 + 事件驱动更新** — 读取 O(1)，写入时同步更新，定期对账兜底
4. **乐观锁防并发** — lock_version 控制并发更新冲突

## 账户命名规则

```
{客户类型}:{客户ID}:{账户类型}:{币种}
```

### 客户账户（Liability）

| 账户 | 说明 |
|------|------|
| `customer:{id}:available:{ccy}` | 可用余额，可提现、换汇、付款 |
| `customer:{id}:pending:{ccy}` | 待结算余额，T+7 后进入 available |
| `customer:{id}:frozen_hold:{ccy}` | 冻结预留，风控冻结的 pending 资金 |
| `customer:{id}:reserve:{ccy}` | 保证金，90 天后释放到 available |

### 平台账户

| 账户 | 类型 | 说明 |
|------|------|------|
| `house:bank:{ccy}` | Asset | 平台银行账户 |
| `receivable:txn:{ccy}` | Asset | 应收交易款（不分客户，汇总） |
| `revenue:fee:acquiring` | Revenue | 收单服务费收入 |
| `expense:refund` | Expense | 退款支出 |
| `expense:card_network_fee` | Expense | 卡组织通道费 |
| `expense:acquirer_fee` | Expense | 收单行费用 |

### 示例

```
客户 abc:
  customer:abc:available:USD      → $94.00
  customer:abc:pending:USD        → $50.00
  customer:abc:frozen_hold:USD    → $20.00
  customer:abc:reserve:USD        → $2.50

客户 xyz:
  customer:xyz:available:EUR      → €300.00
  customer:xyz:pending:EUR        → €500.00
  customer:xyz:frozen_hold:EUR    → €0.00
  customer:xyz:reserve:EUR        → €15.00

平台:
  house:bank:USD                  → $10,000.00
  receivable:txn:USD              → $550.00
  revenue:fee:acquiring           → $25.00
```

## 余额结构

```
┌─────────────────────────────────────────────────────┐
│              customer:{id}:pending:{ccy}             │
│                                                      │
│  pending = pending_available + frozen_hold            │
│  即: pending 账户余额 = 可结算部分 + 冻结部分          │
│                                                      │
│  T+7 结算时: pending - frozen_hold → available        │
│  冻结部分: 解冻后 → available                         │
│                                                      │
├─────────────────────────────────────────────────────┤
│              customer:{id}:available:{ccy}            │
│                                                      │
│  可提现、换汇、付款                                    │
│  如为负数: 从后续收入抵扣                               │
│                                                      │
├─────────────────────────────────────────────────────┤
│              customer:{id}:reserve:{ccy}              │
│                                                      │
│  保证金，90 天后全额释放到 available                    │
│                                                      │
├─────────────────────────────────────────────────────┤
│              customer:{id}:frozen_hold:{ccy}          │
│                                                      │
│  冻结预留，从 pending 借出                              │
│  解冻后贷回 available                                  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## 余额公式

```
可结算金额    = pending - frozen_hold
商户总资金    = available + pending + reserve
可退款金额    = 商户总资金
```

## 并发控制：乐观锁

每个客户账户维护 `lock_version`，更新时校验版本号。

```
1. 读取余额和版本号
   SELECT available_balance, lock_version
   FROM accounts
   WHERE customer_id = 'abc' AND currency = 'USD'
   → available_balance = 94.00, lock_version = 42

2. 计算新余额
   new_balance = 94.00 - 30.00 = 64.00

3. 带版本号更新
   UPDATE accounts
   SET available_balance = 64.00, lock_version = 43
   WHERE customer_id = 'abc'
     AND currency = 'USD'
     AND lock_version = 42

   → affected_rows = 0? 被别人改了，重试
   → affected_rows = 1? 成功
```

## 定期对账

```
每小时执行:

1. 从账本计算真实余额
   real_balance = SUM(贷方分录) - SUM(借方分录)
   WHERE account = 'customer:abc:available:USD'

2. 读取缓存余额
   cached_balance = accounts.available_balance

3. 比较
   IF real_balance != cached_balance
     → 告警 + 以账本为准自动修复
     → 记录漂移日志
```

## 完整分录示例

以客户 abc、原交易 $100、退款 $30、冻结 $20 为例：

```
── T+0 Capture ────────────────────────────────────────

  借  receivable:txn:USD                  +$100.00
  贷  customer:abc:pending:USD            +$100.00

  缓存余额:
    customer:abc:pending = $100

── T+3 退款 $30 ───────────────────────────────────────

  借  customer:abc:pending:USD            -$30.00
  贷  receivable:txn:USD                  -$30.00

  缓存余额:
    customer:abc:pending = $70

── T+5 风控冻结 $20 ───────────────────────────────────

  借  customer:abc:pending:USD            -$20.00
  贷  customer:abc:frozen_hold:USD        +$20.00

  缓存余额:
    customer:abc:pending      = $50
    customer:abc:frozen_hold  = $20
    可结算金额 = $50 - $20 = $30（但 frozen_hold 独立账户，pending 本身已扣）

  注意: pending 已经是 $50，frozen_hold 是独立的 $20
        实际可结算 = pending = $50（冻结部分已不在 pending 里）

── T+7 结算 ───────────────────────────────────────────

  借  customer:abc:pending:USD            -$50.00
  贷  customer:abc:available:USD          +$47.00    ← 商户可用余额
  贷  customer:abc:reserve:USD            +$2.50     ← 保证金 = $50 × 5%
  贷  revenue:fee:acquiring               +$0.50     ← 服务费 = $100 × 1%

  缓存余额:
    customer:abc:pending     = $0
    customer:abc:available   = $47
    customer:abc:reserve     = $2.50
    customer:abc:frozen_hold = $20（仍未解冻）

── T+8 解冻 $20 ───────────────────────────────────────

  借  customer:abc:frozen_hold:USD        -$20.00
  贷  customer:abc:available:USD          +$20.00

  缓存余额:
    customer:abc:available   = $67
    customer:abc:frozen_hold = $0

── T+97 保证金释放 ────────────────────────────────────

  借  customer:abc:reserve:USD            -$2.50
  贷  customer:abc:available:USD          +$2.50

  缓存余额:
    customer:abc:available = $69.50
    customer:abc:reserve   = $0
```

## 负余额场景

```
场景: 商户已提现 $94，后发生退款 $100

T+0   available = $94
T+0   商户提现 $94 → available = $0
T+3   退款 $100
        规则校验: 总资金 = $0 + $100(pending) + $0 = $100 ≥ $100 ✅
        借 customer:abc:pending -$100
        贷 receivable:txn -$100

T+7   结算: pending = $0，无结算

假设后续有新交易结算 $94:
T+10  借 receivable:txn +$94
      贷 customer:abc:pending +$94

T+17  结算 $94:
      服务费 $0.94, 保证金 $4.70
      商户实收 = $94 - $0.94 - $4.70 = $88.36

      但需先抵扣负余额（如有）:
      如 available 已为 -$6 → 实际入账 $88.36 - $6 = $82.36
```
