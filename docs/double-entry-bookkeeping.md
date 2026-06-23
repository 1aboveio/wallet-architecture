# 复式记账分录参考（Double-Entry Bookkeeping Reference）

## 账户总览

### 客户账户（Liability）

| 账户 | 说明 |
|------|------|
| `customer:{id}:available:{ccy}` | 可用余额 |
| `customer:{id}:pending:{ccy}` | 待结算余额 |
| `customer:{id}:frozen_hold:{ccy}` | 冻结预留 |
| `customer:{id}:reserve:fixed:{ccy}` | 固定保证金 |
| `customer:{id}:reserve:rolling:{ccy}` | 滚动保证金 |

### 平台账户

| 账户 | 类型 | 说明 |
|------|------|------|
| `house:bank:{ccy}` | Asset | 平台银行账户 |
| `receivable:txn:{ccy}` | Asset | 应收交易款 |
| `revenue:fee:acquiring` | Revenue | 收单服务费收入 |
| `revenue:fee:fx` | Revenue | 换汇价差收入 |
| `revenue:fee:collection` | Revenue | 收款手续费收入 |
| `revenue:fee:payout` | Revenue | 付款手续费收入 |
| `expense:refund` | Expense | 退款支出 |
| `expense:card_network_fee` | Expense | 卡组织通道费 |
| `expense:acquirer_fee` | Expense | 收单行费用 |
| `clearing:collection:{ccy}` | Clearing | 收款过渡（银行已收未入钱包） |
| `clearing:payout:{ccy}` | Clearing | 提现过渡（钱包已扣未到银行） |
| `clearing:fx:{from}_{to}` | Clearing | 换汇过渡 |

---

## 一、收款（Collection）

场景：Amazon 给客户 abc 打款 $1,000 USD

```
── 银行到账通知 ───────────────────────────────────────

  借  house:bank:USD                      +$1,000.00
  贷  clearing:collection:USD             +$1,000.00

── 确认入客户钱包 ─────────────────────────────────────

  借  clearing:collection:USD             -$1,000.00
  贷  customer:abc:available:USD          +$1,000.00

── 扣除收款手续费（假设 0.5%）─────────────────────────

  借  customer:abc:available:USD          -$5.00
  贷  revenue:fee:collection              +$5.00

最终结果:
  customer:abc:available:USD = $995.00
```

---

## 二、换汇（FX Conversion）

场景：客户 abc 把 $500 USD 换成 EUR，汇率 1 USD = 0.92 EUR，平台价差 0.3%

```
── 扣减源币种余额 ─────────────────────────────────────

  借  customer:abc:available:USD          -$500.00
  贷  clearing:fx:USD_EUR                 +$500.00

── 入账目标币种余额 ───────────────────────────────────

  银行实际换汇: $500 × 0.92 = €460.00
  平台价差: €460 × 0.3% = €1.38
  客户实得: €460 - €1.38 = €458.62

  借  clearing:fx:USD_EUR                 -$500.00
  贷  customer:abc:available:EUR          +€458.62
  贷  revenue:fee:fx                      +€1.38

── 银行端实际换汇 ─────────────────────────────────────

  借  house:bank:EUR                      +€460.00
  贷  house:bank:USD                      -$500.00

最终结果:
  customer:abc:available:USD 余额减少 $500
  customer:abc:available:EUR 余额增加 €458.62
```

---

## 三、提现/付款（Payout）

场景：客户 abc 提现 €400 EUR 到欧洲银行账户，手续费 €2

```
── 扣减客户余额 ───────────────────────────────────────

  借  customer:abc:available:EUR          -€402.00
  贷  clearing:payout:EUR                  +€400.00
  贷  revenue:fee:payout                  +€2.00

── 银行汇出 ───────────────────────────────────────────

  借  clearing:payout:EUR                  -€400.00
  贷  house:bank:EUR                      -€400.00

最终结果:
  customer:abc:available:EUR 余额减少 €402
  平台银行账户减少 €400
  平台收入 €2
```

---

## 四、收单（Acquiring）— 无退款

场景：买家刷信用卡付 $100 给客户 abc，无退款，服务费 1%，保证金 5%

```
── T+0 Capture 请款 ──────────────────────────────────

  借  receivable:txn:USD                  +$100.00
  贷  customer:abc:pending:USD            +$100.00

── T+2 上游结算（独立事件）────────────────────────────

  借  house:bank:USD                      +$97.50
  借  expense:card_network_fee            +$1.50
  借  expense:acquirer_fee                +$1.00
  贷  receivable:txn:USD                  -$100.00

── T+7 结算给商户 ─────────────────────────────────────

  借  customer:abc:pending:USD            -$100.00
  贷  customer:abc:available:USD          +$94.00
  贷  customer:abc:reserve:fixed:USD      +$3.00     ← 固定保证金 $100 × 3%
  贷  customer:abc:reserve:rolling:USD    +$2.00     ← 滚动保证金 $100 × 2%
  贷  revenue:fee:acquiring               +$1.00     ← $100 × 1%

── T+97 保证金释放 ────────────────────────────────────

  借  customer:abc:reserve:fixed:USD      -$3.00
  借  customer:abc:reserve:rolling:USD    -$2.00
  贷  customer:abc:available:USD          +$5.00

最终结果:
  customer:abc:available:USD = $99.00 ($94 + $5 释放)
  上游成本: $2.50（卡组织 $1.50 + 收单行 $1.00）
  平台收入: $1.00 服务费 - $2.50 通道费 = -$1.50（毛亏，实际靠规模盈利）
```

---

## 五、收单（Acquiring）— 部分退款 $30（结算后退款）

场景：买家刷信用卡付 $100，结算后退款 $30，服务费 1%，保证金 5%（固定 3% + 滚动 2%）

**注：** 退款只能在 SETTLED 之后发起（见 ADR 0003），settlement 前的撤销走 VOIDED 流程。

```
── T+0 Capture ────────────────────────────────────────

  借  receivable:txn:USD                  +$100.00
  贷  customer:abc:pending:USD            +$100.00

── T+2 上游结算（独立事件）────────────────────────────

  借  house:bank:USD                      +$97.50
  借  expense:card_network_fee            +$1.50
  借  expense:acquirer_fee                +$1.00
  贷  receivable:txn:USD                  -$100.00

── T+7 结算给商户 ─────────────────────────────────────

  借  customer:abc:pending:USD            -$100.00
  贷  customer:abc:available:USD          +$94.00
  贷  customer:abc:reserve:fixed:USD      +$3.00     ← 固定保证金 $100 × 3%
  贷  customer:abc:reserve:rolling:USD    +$2.00     ← 滚动保证金 $100 × 2%
  贷  revenue:fee:acquiring               +$1.00     ← 服务费 $100 × 1%

── T+10 退款 $30（SETTLED 后，从 available 扣减）──────

  借  customer:abc:available:USD           -$30.00
  贷  receivable:txn:USD                   -$30.00

  滚动保证金按比例退回 = $30/$100 × $2.00 = $0.60:
  借  customer:abc:reserve:rolling:USD     -$0.60
  贷  customer:abc:available:USD           +$0.60

  缓存余额:
    available       = $94.00 - $30.00 + $0.60 = $64.60
    reserve:fixed   = $3.00
    reserve:rolling = $2.00 - $0.60 = $1.40

── T+97 保证金释放（滚动部分剩余）─────────────────────

  借  customer:abc:reserve:rolling:USD     -$1.40
  贷  customer:abc:available:USD           +$1.40

最终结果:
  customer:abc:available:USD = $66.00 ($64.60 + $1.40 释放)
```

---

## 六、收单（Acquiring）— 全额退款（结算后退款）

场景：买家刷信用卡付 $100，结算后全额退款 $100，服务费 1%，保证金 5%（固定 3% + 滚动 2%）

**注：** 退款只能在 SETTLED 之后发起（见 ADR 0003）。

```
── T+0 Capture ────────────────────────────────────────

  借  receivable:txn:USD                  +$100.00
  贷  customer:abc:pending:USD            +$100.00

── T+2 上游结算（独立事件）────────────────────────────

  借  house:bank:USD                      +$97.50
  借  expense:card_network_fee            +$1.50
  借  expense:acquirer_fee                +$1.00
  贷  receivable:txn:USD                  -$100.00

── T+7 结算给商户 ─────────────────────────────────────

  借  customer:abc:pending:USD            -$100.00
  贷  customer:abc:available:USD          +$94.00
  贷  customer:abc:reserve:fixed:USD      +$3.00
  贷  customer:abc:reserve:rolling:USD    +$2.00
  贷  revenue:fee:acquiring               +$1.00

── T+14 全额退款 $100（SETTLED 后，从 available 扣减）──

  借  customer:abc:available:USD           -$100.00
  贷  receivable:txn:USD                   -$100.00

  滚动保证金全额退回:
  借  customer:abc:reserve:rolling:USD     -$2.00
  贷  customer:abc:available:USD           +$2.00

  固定保证金: 不退回（全局目标，与单笔交易无关）

最终结果:
  customer:abc:available:USD = -$4.00（负余额）
  reserve:fixed = $3.00（不变）
  reserve:rolling = $0
  后续收入自动抵扣负余额 -$4.00
```

---

## 七、风控冻结与解冻

场景：客户 abc 有一笔 $100 交易 pending，风控冻结其中 $50

```
── 冻结操作 ───────────────────────────────────────────

  借  customer:abc:pending:USD            -$50.00
  贷  customer:abc:frozen_hold:USD        +$50.00

  缓存余额:
    customer:abc:pending      = $50  （可结算部分）
    customer:abc:frozen_hold  = $50  （冻结部分）

── 解冻操作（风控解除）────────────────────────────────

  借  customer:abc:frozen_hold:USD        -$50.00
  贷  customer:abc:available:USD          +$50.00

  缓存余额:
    customer:abc:pending      = $50
    customer:abc:frozen_hold  = $0
    customer:abc:available    = $50

── 如果解冻后需要回到 pending（而非直接可用）──────────

  借  customer:abc:frozen_hold:USD        -$50.00
  贷  customer:abc:pending:USD            +$50.00

  缓存余额:
    customer:abc:pending      = $100 （恢复原状）
    customer:abc:frozen_hold  = $0
```

---

## 八、负余额抵扣

场景：商户 available = -$6，新交易结算 $94

```
── 新交易结算 ─────────────────────────────────────────

  借  customer:abc:pending:USD            -$94.00
  贷  customer:abc:available:USD          +$88.36    ← $94 - 费用 - 保证金 - 负余额抵扣
  贷  customer:abc:reserve:fixed:USD      +$2.82     ← 固定保证金 $94 × 3%
  贷  customer:abc:reserve:rolling:USD    +$1.88     ← 滚动保证金 $94 × 2%
  贷  revenue:fee:acquiring               +$0.94     ← 服务费

  负余额抵扣逻辑:
    理论入账 = $94 - $0.94 - $2.82 - $1.88 = $88.36
    负余额 = -$6
    实际入账 = $88.36 - $6 = $82.36

  修正分录:
  借  customer:abc:pending:USD            -$94.00
  贷  customer:abc:available:USD          +$82.36    ← 抵扣负余额后
  贷  customer:abc:reserve:fixed:USD      +$2.82
  贷  customer:abc:reserve:rolling:USD    +$1.88
  贷  revenue:fee:acquiring               +$0.94
  贷  customer:abc:available:USD          +$6.00     ← 负余额冲回（贷方增加）

  等效于:
  借  customer:abc:pending:USD            -$94.00
  贷  customer:abc:available:USD          +$88.36    ← 正常结算金额
  贷  customer:abc:reserve:fixed:USD      +$2.82
  贷  customer:abc:reserve:rolling:USD    +$1.88
  贷  revenue:fee:acquiring               +$0.94

  然后负余额自动抵扣:
    available: -$6 + $88.36 = $82.36
```

---

## 九、汇总：收单全流程（含退款+冻结+保证金释放）

场景：客户 abc，原交易 $100，退款 $30（结算后），冻结 $20，服务费 1%，保证金 5%（固定 3% + 滚动 2%）

```
── T+0 Capture ────────────────────────────────────────

  借  receivable:txn:USD                  +$100.00
  贷  customer:abc:pending:USD            +$100.00

  pending: $100

── T+2 上游结算 ───────────────────────────────────────

  借  house:bank:USD                      +$97.50
  借  expense:card_network_fee            +$1.50
  借  expense:acquirer_fee                +$1.00
  贷  receivable:txn:USD                  -$100.00

── T+5 风控冻结 $20 ───────────────────────────────────

  借  customer:abc:pending:USD            -$20.00
  贷  customer:abc:frozen_hold:USD        +$20.00

  pending: $80
  frozen_hold: $20

── T+7 结算 ───────────────────────────────────────────

  实际结算金额 = pending = $80
  保证金 = $100 × 5% = $5.00（固定 $3 + 滚动 $2）
  服务费 = $100 × 1% = $1.00

  借  customer:abc:pending:USD            -$80.00
  贷  customer:abc:available:USD          +$74.00
  贷  customer:abc:reserve:fixed:USD      +$3.00
  贷  customer:abc:reserve:rolling:USD    +$2.00
  贷  revenue:fee:acquiring               +$1.00

  pending: $0
  available: $74.00
  reserve:fixed: $3.00
  reserve:rolling: $2.00
  frozen_hold: $20（仍未解冻）

── T+8 解冻 $20 ───────────────────────────────────────

  借  customer:abc:frozen_hold:USD        -$20.00
  贷  customer:abc:available:USD          +$20.00

  frozen_hold: $0
  available: $94.00

── T+10 退款 $30（SETTLED 后，从 available 扣减）──────

  借  customer:abc:available:USD           -$30.00
  贷  receivable:txn:USD                   -$30.00

  滚动保证金按比例退回 = $30/$100 × $2.00 = $0.60:
  借  customer:abc:reserve:rolling:USD     -$0.60
  贷  customer:abc:available:USD           +$0.60

  available: $94.00 - $30.00 + $0.60 = $64.60
  reserve:rolling: $2.00 - $0.60 = $1.40

── T+97 保证金释放（滚动部分剩余）─────────────────────

  借  customer:abc:reserve:rolling:USD     -$1.40
  贷  customer:abc:available:USD           +$1.40

  reserve:rolling: $0
  available: $66.00

── 最终汇总 ───────────────────────────────────────────

  客户 abc 最终状态:
    available:      $66.00
    pending:        $0
    frozen_hold:    $0
    reserve:fixed:  $3.00（未释放，手动触发）
    reserve:rolling: $0

  平台收入:
    服务费:   $1.00
    通道费:  -$2.50
    净收入:  -$1.50（本笔亏损，规模效应下整体盈利）

  资金流向:
    买家付 $100 → 卡组织扣 $2.50 → PF 银行到账 $97.50
    PF 结算给商户 $74.00 + 解冻 $20 + 滚动释放 $1.40 = $95.40
    退款 $30 从商户 available 扣减（含滚动保证金退回 $0.60）
    PF 留下 $1.00 服务费
```

---

## 分录规则速查

| 场景 | 借方 | 贷方 |
|------|------|------|
| **收款到账** | house:bank | customer:available |
| **换汇（扣源币）** | customer:available | clearing:fx |
| **换汇（入目标币）** | clearing:fx | customer:available + revenue:fee:fx |
| **提现** | customer:available | house:bank + revenue:fee:payout |
| **Capture** | receivable:txn | customer:pending |
| **退款** | customer:available | receivable:txn |
| **冻结** | customer:pending | customer:frozen_hold |
| **解冻** | customer:frozen_hold | customer:available |
| **结算** | customer:pending | customer:available + customer:reserve:fixed + customer:reserve:rolling + revenue:fee |
| **保证金释放** | customer:reserve:fixed / customer:reserve:rolling | customer:available |
| **上游到账** | house:bank | receivable:txn + expense:fees |
