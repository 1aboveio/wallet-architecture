# 账户体系与余额设计（Account & Balance Design）

不变量见 [ADR 0005](adr/0005-ledger-invariants.md)。下文是命名与缓存实现。

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
| `customer:{id}:pending:{ccy}` | CAPTURE 清分后的结算净额。SETTLED 前不可提现；SETTLED 时转入 available |
| `customer:{id}:frozen_hold:{ccy}` | 冻结预留，风控冻结的 pending 资金 |
| `customer:{id}:reserve:fixed:{ccy}` | 固定保证金，手动释放到 available |
| `customer:{id}:reserve:rolling:{ccy}` | 滚动保证金，N 天后自动释放到 available |

### 平台账户

| 账户 | 类型 | 说明 |
|------|------|------|
| `house:bank:{ccy}` | Asset | 平台银行账户 |
| `receivable:txn:{ccy}` | Asset | 应收交易款（不分客户，汇总） |
| `revenue:fee:acquiring:{ccy}` | Revenue | MDR 收入 |
| `expense:refund:{ccy}` | Expense | 退款支出 |
| `expense:card_network_fee:{ccy}` | Expense | 卡组织通道费 |
| `expense:acquirer_fee:{ccy}` | Expense | 收单行费用 |
| `payable:acquirer:{ccy}` | Liability | 应付通道/收单行费用（上游未付） |

### 示例

```
客户 abc:
  customer:abc:available:USD      → $94.00
  customer:abc:pending:USD        → $50.00
  customer:abc:frozen_hold:USD    → $20.00
  customer:abc:reserve:fixed:USD    → $1.50
  customer:abc:reserve:rolling:USD  → $1.00

客户 xyz:
  customer:xyz:available:EUR      → €300.00
  customer:xyz:pending:EUR        → €500.00
  customer:xyz:frozen_hold:EUR    → €0.00
  customer:xyz:reserve:rolling:EUR → €15.00

平台:
  house:bank:USD                  → $10,000.00
  receivable:txn:USD              → $550.00
  revenue:fee:acquiring:USD       → $25.00
```

## 余额结构

```
┌─────────────────────────────────────────────────────┐
│              customer:{id}:pending:{ccy}             │
│                                                      │
│  冻结时: pending 减少, frozen_hold 增加（划出）    │
│  解冻后: frozen_hold → available 或 pending          │
│                                                      │
│  CAPTURE 清分: pending 拆进 available / reserve / 收入 │
│  冻结部分: 解冻后 → available 或 pending              │
│                                                      │
├─────────────────────────────────────────────────────┤
│              customer:{id}:available:{ccy}            │
│                                                      │
│  可提现、换汇、付款                                    │
│  如为负数: 从后续收入抵扣                               │
│                                                      │
├─────────────────────────────────────────────────────┤
│              customer:{id}:reserve:fixed:{ccy}        │
│                                                      │
│  固定保证金，手动释放到 available                       │
│                                                      │
├─────────────────────────────────────────────────────┤
│              customer:{id}:reserve:rolling:{ccy}      │
│                                                      │
│  滚动保证金，N 天后自动释放到 available                 │
│                                                      │
├─────────────────────────────────────────────────────┤
│              customer:{id}:frozen_hold:{ccy}          │
│                                                      │
│  冻结预留，从 pending 中划出（pending 减少对应金额）      │
│  解冻后转回 available；仍待结则回 pending               │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## 余额公式

```
可结算金额    = pending（冻结已从 pending 划出，不要再减 frozen_hold）
商户总资金    = available + pending + frozen_hold + reserve:fixed + reserve:rolling + special_account
S = 该笔结算币种
可退款覆盖    = available:{S} + pending:{S} + (主币种 available / fallback_fx_rate)
退款实扣      = 先扣 available:{S}，不足再扣 available:{primary}
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

同币种示意。CAPTURE 清分、退款即期与主币种兜底见 [ADR 0004](adr/0004-multi-currency-clearing.md)。退款不得从 pending 扣。

以客户 abc、请款 $100 为例：

```
── CAPTURE 入账 + 清分（同币种）────────────────────────

  借  receivable:txn:USD                  +$100.00
  贷  customer:abc:pending:USD            +$100.00

  借  customer:abc:pending:USD            -$100.00
  贷  customer:abc:available:USD          +$94.00
  贷  customer:abc:reserve:fixed:USD      +$3.00
  贷  customer:abc:reserve:rolling:USD    +$2.00
  贷  revenue:fee:acquiring:USD           +$1.00

── SETTLED 后退款请款 $30 ─────────────────────────────

  借  customer:abc:available:USD          -$30.00
  贷  receivable:txn:USD                  -$30.00
  借  revenue:fee:acquiring:USD           -$0.30
  贷  customer:abc:available:USD          +$0.30
  借  customer:abc:reserve:rolling:USD    -$0.60
  贷  customer:abc:available:USD          +$0.60

冻结是 pending → frozen_hold，与退款无关。
```

## 负余额场景

```
场景: 商户已提现，SETTLED 后全额退款（同币种，ADR 0001 / 0004）

available = $0（已提现）
退款请款 $100 → 退款入账 $100
实扣 available:USD（= primary）→ -$100（不拒绝）
退 MDR、退滚动 HELD 贷回 available
固定不退
后续同币种结算净额先冲负 available
```
