# 账户设计双视角（Dual Perspective Chart of Accounts）

本文档提供两套账户命名方案，覆盖相同的业务场景。团队可根据自身背景选择使用。

- **方案 A：财务视角** — 使用传统会计科目（Receivable、Payable），适合财务团队主导
- **方案 B：支付行业视角** — 使用 Clearing 过渡账户，适合支付产品/技术团队主导

两套方案的**记账逻辑完全一致**，仅账户命名不同。

---

## 方案 A：财务视角（Financial Accounting Perspective）

### 账户表

| 账户 | 类型 | 说明 |
|------|------|------|
| `customer:{id}:available:{ccy}` | Liability | 客户可用余额 |
| `customer:{id}:pending:{ccy}` | Liability | 客户待结算余额 |
| `customer:{id}:frozen_hold:{ccy}` | Liability | 客户冻结预留 |
| `customer:{id}:reserve:{ccy}` | Liability | 客户保证金 |
| `house:bank:{ccy}` | Asset | 平台银行账户 |
| `receivable:txn:{ccy}` | Asset | 应收交易款（收单行欠平台） |
| `receivable:collection:{ccy}` | Asset | 应收收款款（平台欠客户，待入账） |
| `payable:payout:{ccy}` | Liability | 应付提现款（平台已扣未汇出） |
| `revenue:fee:acquiring` | Revenue | 收单服务费收入 |
| `revenue:fee:collection` | Revenue | 收款手续费收入 |
| `revenue:fee:payout` | Revenue | 提现手续费收入 |
| `revenue:fee:fx` | Revenue | 换汇价差收入 |
| `expense:refund` | Expense | 退款支出 |
| `expense:card_network_fee` | Expense | 卡组织通道费 |
| `expense:acquirer_fee` | Expense | 收单行费用 |

### 特点

- `receivable` 明确表达"别人欠我的"
- `payable` 明确表达"我欠别人的"
- 符合 GAAP/IFRS 会计准则
- 财务人员一看就懂

---

## 方案 B：支付行业视角（Payment Industry Perspective）

### 账户表

| 账户 | 类型 | 说明 |
|------|------|------|
| `customer:{id}:available:{ccy}` | Liability | 客户可用余额 |
| `customer:{id}:pending:{ccy}` | Liability | 客户待结算余额 |
| `customer:{id}:frozen_hold:{ccy}` | Liability | 客户冻结预留 |
| `customer:{id}:reserve:{ccy}` | Liability | 客户保证金 |
| `house:bank:{ccy}` | Asset | 平台银行账户 |
| `clearing:acquiring:{ccy}` | Clearing | 收单过渡（钱在路上） |
| `clearing:collection:{ccy}` | Clearing | 收款过渡（银行已收未入钱包） |
| `clearing:payout:{ccy}` | Clearing | 提现过渡（钱包已扣未到银行） |
| `clearing:fx:{from}_{to}` | Clearing | 换汇过渡 |
| `revenue:fee:acquiring` | Revenue | 收单服务费收入 |
| `revenue:fee:collection` | Revenue | 收款手续费收入 |
| `revenue:fee:payout` | Revenue | 提现手续费收入 |
| `revenue:fee:fx` | Revenue | 换汇价差收入 |
| `expense:refund` | Expense | 退款支出 |
| `expense:card_network_fee` | Expense | 卡组织通道费 |
| `expense:acquirer_fee` | Expense | 收单行费用 |

### 特点

- `clearing` 表达"资金在通道中"
- 不区分应收/应付，统一用过渡账户
- Stripe、Adyen、Airwallex 等支付公司常用
- 开发人员一看就懂

---

## 两套方案对照表

| 业务场景 | 方案 A（财务视角） | 方案 B（支付行业视角） |
|----------|-------------------|----------------------|
| 收单 Capture | `receivable:txn:{ccy}` | `clearing:acquiring:{ccy}` |
| 收款入账 | `receivable:collection:{ccy}` | `clearing:collection:{ccy}` |
| 提现汇出 | `payable:payout:{ccy}` | `clearing:payout:{ccy}` |
| 换汇过渡 | `clearing:fx:{from}_{to}` | `clearing:fx:{from}_{to}` |

---

## 同一场景：两套分录对比

### 收单（Acquiring）— 无退款，$100

#### 方案 A：财务视角

```
── T+0 Capture ────────────────────────────────

  借  receivable:txn:USD                  +$100.00   (收单行欠我)
  贷  customer:abc:pending:USD            +$100.00   (我欠商户)

── T+2 上游结算 ──────────────────────────────

  借  house:bank:USD                      +$97.50    (银行到账)
  借  expense:card_network_fee            +$1.50     (卡组织费用)
  借  expense:acquirer_fee                +$1.00     (收单行费用)
  贷  receivable:txn:USD                  -$100.00   (应收清零)

── T+7 结算给商户 ────────────────────────────

  借  customer:abc:pending:USD            -$100.00
  贷  customer:abc:available:USD          +$94.00
  贷  customer:abc:reserve:USD            +$5.00
  贷  revenue:fee:acquiring               +$1.00
```

#### 方案 B：支付行业视角

```
── T+0 Capture ────────────────────────────────

  借  clearing:acquiring:USD              +$100.00   (钱在路上)
  贷  customer:abc:pending:USD            +$100.00   (待结算)

── T+2 上游结算 ──────────────────────────────

  借  house:bank:USD                      +$97.50    (银行到账)
  借  expense:card_network_fee            +$1.50     (卡组织费用)
  借  expense:acquirer_fee                +$1.00     (收单行费用)
  贷  clearing:acquiring:USD              -$100.00   (过渡清零)

── T+7 结算给商户 ────────────────────────────

  借  customer:abc:pending:USD            -$100.00
  贷  customer:abc:available:USD          +$94.00
  贷  customer:abc:reserve:USD            +$5.00
  贷  revenue:fee:acquiring               +$1.00
```

---

### 收款（Collection）— Amazon 打 $1,000

#### 方案 A：财务视角

```
── 银行到账 ───────────────────────────────────

  借  house:bank:USD                      +$1,000.00
  贷  receivable:collection:USD           +$1,000.00  (平台欠客户，待入账)

── 入客户钱包 ────────────────────────────────

  借  receivable:collection:USD           -$1,000.00
  贷  customer:abc:available:USD          +$995.00
  贷  revenue:fee:collection              +$5.00
```

#### 方案 B：支付行业视角

```
── 银行到账 ───────────────────────────────────

  借  house:bank:USD                      +$1,000.00
  贷  clearing:collection:USD             +$1,000.00  (收款过渡)

── 入客户钱包 ────────────────────────────────

  借  clearing:collection:USD             -$1,000.00
  贷  customer:abc:available:USD          +$995.00
  贷  revenue:fee:collection              +$5.00
```

---

### 提现（Payout）— 客户提现 $400

#### 方案 A：财务视角

```
── 扣减客户余额 ───────────────────────────────

  借  customer:abc:available:USD          -$402.00
  贷  payable:payout:USD                  +$400.00   (应付提现款)
  贷  revenue:fee:payout                  +$2.00

── 银行汇出 ───────────────────────────────────

  借  payable:payout:USD                  -$400.00
  贷  house:bank:USD                      -$400.00
```

#### 方案 B：支付行业视角

```
── 扣减客户余额 ───────────────────────────────

  借  customer:abc:available:USD          -$402.00
  贷  clearing:payout:USD                 +$400.00   (提现过渡)
  贷  revenue:fee:payout                  +$2.00

── 银行汇出 ───────────────────────────────────

  借  clearing:payout:USD                 -$400.00
  贷  house:bank:USD                      -$400.00
```

---

### 换汇（FX）— $500 USD → EUR

两套方案相同，换汇过渡账户命名一致。

```
── 扣减 USD ───────────────────────────────────

  借  customer:abc:available:USD          -$500.00
  贷  clearing:fx:USD_EUR                 +$500.00

── 入账 EUR ───────────────────────────────────

  借  clearing:fx:USD_EUR                 -$500.00
  贷  customer:abc:available:EUR          +€458.62
  贷  revenue:fee:fx                      +€1.38

── 银行换汇 ───────────────────────────────────

  借  house:bank:EUR                      +€460.00
  贷  house:bank:USD                      -$500.00
```

---

## 选择建议

| 场景 | 推荐方案 |
|------|----------|
| 财务团队主导、需要对接审计 | 方案 A（财务视角） |
| 技术团队主导、快速开发 | 方案 B（支付行业视角） |
| 需要同时服务两个团队 | 两套命名并存，底层共享一套账本 |

### 并存方案

如果两套命名需要并存，可以在账本层用一套命名，在展示层做映射：

```
底层账本（技术视角）:
  clearing:acquiring:USD

财务报表映射:
  clearing:acquiring:USD → 应收交易款（USD）

API 返回:
  {
    "account": "clearing:acquiring:USD",
    "display_name": "应收交易款",
    "balance": 100.00
  }
```
