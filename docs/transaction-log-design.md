# 流水账设计（Transaction Log Design）

## 概述

支付系统需要两套记录，各司其职：

| | 账本（Ledger） | 流水账（Transaction Log） |
|---|---|---|
| **回答什么问题** | 钱怎么变的？余额为什么是这个数？ | 发生了什么事？谁跟谁交易？ |
| **结构** | 复式分录（借/贷） | 业务事件记录 |
| **记录内容** | 账户、金额、方向 | 交易 ID、买家、商户、金额、时间、状态、支付方式 |
| **谁用** | 财务、审计、对账 | 产品、运营、客服、风控 |
| **查询模式** | 按账户聚合余额 | 按交易 ID / 时间 / 商户查询 |

**核心关系：一笔业务事件 → 一条流水记录 → 一条或多条账本分录**

## 流水账与账本的关系

```
                    业务事件
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
    ┌──────────┐               ┌──────────┐
    │ 流水账    │               │   账本    │
    │          │               │          │
    │ 记录"事"  │               │ 记录"钱"  │
    │ TXN-001  │──────────────▶│ JNL-001  │
    │ 买家是谁  │  transaction  │ 借/贷多少 │
    │ 什么商品  │    _ref       │ 哪个账户  │
    │ 什么渠道  │               │          │
    └──────────┘               └──────────┘
```

## 流水账类型

### 1. 交易流水（Transaction Log）

记录每笔支付交易的完整生命周期。

```sql
CREATE TABLE transactions (
    id              BIGINT PRIMARY KEY,
    transaction_id  VARCHAR(64) UNIQUE NOT NULL,    -- 交易唯一标识
    type            VARCHAR(32) NOT NULL,            -- CAPTURE / AUTH / VOID
    merchant_id     VARCHAR(64) NOT NULL,            -- 商户 ID
    buyer_info      JSONB,                           -- 买家信息（脱敏）
    amount          DECIMAL(18,4) NOT NULL,          -- 交易金额
    currency        VARCHAR(3) NOT NULL,             -- 币种
    status          VARCHAR(32) NOT NULL,            -- INIT / PAYING / PAID / CAPTURED / SETTLED / CANCELED / VOIDED / REFUNDED / REFUNDED_FULL
    payment_method  VARCHAR(32),                     -- CARD / BANK_TRANSFER
    platform        VARCHAR(64),                     -- 来源平台
    metadata        JSONB,                           -- 扩展信息
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    INDEX idx_merchant_created (merchant_id, created_at),
    INDEX idx_status (status)
);
```

### 2. 退款流水（Refund Log）

记录每笔退款。

```sql
CREATE TABLE refunds (
    id              BIGINT PRIMARY KEY,
    refund_id       VARCHAR(64) UNIQUE NOT NULL,     -- 退款唯一标识
    transaction_id  VARCHAR(64) NOT NULL,            -- 关联原交易
    merchant_id     VARCHAR(64) NOT NULL,
    amount          DECIMAL(18,4) NOT NULL,          -- 退款金额
    currency        VARCHAR(3) NOT NULL,
    reason          VARCHAR(256),                    -- 退款原因
    status          VARCHAR(32) NOT NULL,            -- PENDING / COMPLETED / FAILED
    created_at      TIMESTAMPTZ NOT NULL,
    INDEX idx_transaction (transaction_id),
    INDEX idx_merchant_created (merchant_id, created_at)
);
```

### 3. 结算流水（Settlement Log）

记录每笔结算批次。

```sql
CREATE TABLE settlements (
    id              BIGINT PRIMARY KEY,
    settlement_id   VARCHAR(64) UNIQUE NOT NULL,     -- 结算批次 ID
    merchant_id     VARCHAR(64) NOT NULL,
    period_start    TIMESTAMPTZ NOT NULL,             -- 结算周期开始
    period_end      TIMESTAMPTZ NOT NULL,             -- 结算周期结束
    gross_amount    DECIMAL(18,4) NOT NULL,           -- 毛额
    refund_amount   DECIMAL(18,4) NOT NULL,           -- 退款扣减
    fee_amount      DECIMAL(18,4) NOT NULL,           -- 服务费
    reserve_amount  DECIMAL(18,4) NOT NULL,           -- 保证金
    net_amount      DECIMAL(18,4) NOT NULL,           -- 商户实收
    currency        VARCHAR(3) NOT NULL,
    status          VARCHAR(32) NOT NULL,             -- PENDING / PROCESSING / COMPLETED
    created_at      TIMESTAMPTZ NOT NULL,
    INDEX idx_merchant_created (merchant_id, created_at)
);
```

### 4. 资金流水（Fund Movement Log）

记录每次资金流动。

```sql
CREATE TABLE fund_movements (
    id              BIGINT PRIMARY KEY,
    movement_id     VARCHAR(64) UNIQUE NOT NULL,
    type            VARCHAR(32) NOT NULL,             -- COLLECTION / PAYOUT / FX / ACQUIRING
    merchant_id     VARCHAR(64) NOT NULL,
    source_account  VARCHAR(128) NOT NULL,            -- 来源账户
    target_account  VARCHAR(128) NOT NULL,            -- 目标账户
    amount          DECIMAL(18,4) NOT NULL,
    currency        VARCHAR(3) NOT NULL,
    reference_id    VARCHAR(64),                      -- 关联业务 ID
    created_at      TIMESTAMPTZ NOT NULL,
    INDEX idx_merchant_created (merchant_id, created_at),
    INDEX idx_reference (reference_id)
);
```

### 5. 账户流水（Account Activity Log）

记录每次余额变更。

```sql
CREATE TABLE account_activities (
    id              BIGINT PRIMARY KEY,
    account_id      VARCHAR(128) NOT NULL,            -- 完整账户名
    entry_id        VARCHAR(64) NOT NULL,             -- 关联账本分录
    direction       VARCHAR(4) NOT NULL,              -- DEBIT / CREDIT
    amount          DECIMAL(18,4) NOT NULL,
    balance_before  DECIMAL(18,4) NOT NULL,           -- 变更前余额
    balance_after   DECIMAL(18,4) NOT NULL,           -- 变更后余额
    reference_id    VARCHAR(64),                      -- 关联业务 ID
    created_at      TIMESTAMPTZ NOT NULL,
    INDEX idx_account_created (account_id, created_at)
);
```

### 6. 操作流水（Operation Audit Log）

记录人工操作和系统事件。

```sql
CREATE TABLE operation_logs (
    id              BIGINT PRIMARY KEY,
    operation_id    VARCHAR(64) UNIQUE NOT NULL,
    operator_id     VARCHAR(64) NOT NULL,             -- 操作人（系统/人工）
    operation_type  VARCHAR(32) NOT NULL,             -- FREEZE / UNFREEZE / ADJUST / REVERSE
    target_account  VARCHAR(128),
    amount          DECIMAL(18,4),
    reason          VARCHAR(512),
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL,
    INDEX idx_operator_created (operator_id, created_at),
    INDEX idx_operation_type (operation_type)
);
```

## 流水账与账本的关联

每条流水记录通过 `reference_id` 或 `transaction_ref` 关联到账本分录：

```
交易流水                    账本分录
transactions               entries
┌──────────────┐           ┌──────────────┐
│ TXN-001      │──────────▶│ JNL-001      │ (Capture 分录)
│ type: CAPTURE │           │ JNL-002      │ (退款分录)
│ amount: $100  │           │ JNL-003      │ (冻结分录)
└──────────────┘           └──────────────┘

退款流水                    账本分录
refunds                     entries
┌──────────────┐           ┌──────────────┐
│ RFD-001      │──────────▶│ JNL-002      │
│ txn: TXN-001 │           │ debit: pending│
│ amount: $30  │           │ credit: txn   │
└──────────────┘           └──────────────┘
```

## 完整示例：一笔交易的全部记录

```
事件：买家在商户 abc 的独立站刷 Visa 信用卡支付 $100，后退款 $30

── 流水账记录 ──────────────────────────────────────────

1. transactions:
   TXN-001 | CAPTURE | merchant:abc | $100 | USD | CAPTURED | Visa ****4242

2. transactions (状态更新):
   TXN-001 | CAPTURE | merchant:abc | $100 | USD | SETTLED

3. refunds:
   RFD-001 | TXN-001 | merchant:abc | $30 | USD | COMPLETED | buyer_request

4. settlements:
   STL-001 | merchant:abc | $100 | -$30 | -$1 | -$3.50 | $65.50 | COMPLETED

── 账本分录 ────────────────────────────────────────────

1. JNL-001 (Capture):
   借  clearing:acquiring:USD       +$100
   贷  customer:abc:pending:USD     +$100

2. JNL-002 (退款):
   借  customer:abc:pending:USD     -$30
   贷  receivable:txn:USD           -$30

3. JNL-003 (结算):
   借  customer:abc:pending:USD     -$70
   贷  customer:abc:available:USD   +$65.50
   贷  customer:abc:reserve:USD     +$3.50
   贷  revenue:fee:acquiring        +$1.00
```

## 查询场景对照

| 需求 | 查哪里 |
|------|--------|
| "商户 abc 的余额是多少？" | 账本 → accounts |
| "TXN-001 这笔交易的详情？" | 流水账 → transactions |
| "商户 abc 本月收了多少钱？" | 流水账 → transactions GROUP BY merchant_id |
| "为什么余额少了 $30？" | 账本 → entries WHERE account = 'customer:abc:pending:USD' |
| "谁操作了冻结？" | 流水账 → operation_logs WHERE operation_type = 'FREEZE' |
| "对账差异在哪？" | 账本余额 vs 银行流水，逐笔比对 |

## 设计原则

1. **流水账是业务真相** — 记录发生了什么，面向业务查询
2. **账本是财务真相** — 记录钱怎么动的，面向余额计算和审计
3. **两层通过 reference_id 关联** — 任何一方都能追溯到另一方
4. **流水账可以更新状态** — 交易从 CAPTURED 变成 SETTLED 是状态流转
5. **账本分录不可变** — 只追加不修改，错误用反向分录冲正
6. **各自独立查询** — 流水账不依赖账本，账本不依赖流水账
