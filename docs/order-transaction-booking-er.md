# Order - Transaction - Balance Movement - Ledger Entry 关系图

## 分层模型

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│   Transaction（动作）                                                            │
│   │  渠道返回的状态变更动作                                                        │
│   │  如：AUTH、CAPTURE、VOID、REFUND                                             │
│   │                                                                             │
│   │  驱动 ↓                                                                      │
│   ▼                                                                             │
│   Order（状态）                                                                  │
│   │  支付意图的业务状态                                                            │
│   │  如：CREATED → CONFIRMED → COMPLETED → REFUNDED                             │
│   │                                                                             │
│   │  CAPTURE 时触发 Clearing（过程）                                              │
│   │  计算费用、保证金、净额                                                        │
│   │                                                                             │
│   │  生成 ↓                                                                      │
│   ▼                                                                             │
│   Balance Movement（资金账）                                                     │
│   │  记录每一笔余额变动                                                           │
│   │  如：商户 pending +$100、平台收入 +$1、保证金 -$5                              │
│   │                                                                             │
│   │  对应 ↓                                                                      │
│   ▼                                                                             │
│   Ledger Entry（会计分录）                                                       │
│       复式分录（借/贷）                                                           │
│       如：借 应收收单行 +$100 / 贷 应付商户待结算 +$100                            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 概念定义

| 概念 | 语义 | 类比 | 谁关心 |
|------|------|------|--------|
| **Transaction** | 支付动作（渠道返回） | Stripe Charge | 支付系统、风控 |
| **Order** | 支付意图状态 | Stripe PaymentIntent | 支付系统、商户 |
| **Clearing** | 清分过程（非实体） | — | — |
| **Balance Movement** | 资金/余额变动 | Stripe Balance Transaction | 财务、对账 |
| **Ledger Entry** | 会计分录（复式记账） | Stripe Accounting | 财务、审计 |

**注：** Clearing 是一个计算过程，不是独立实体。CAPTURE 时实时执行，直接生成 Balance Movement，不单独入库。

## ER 关系图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│   Order（支付意图 / Payment Intent）                                              │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  order_id: ORD-001                                                       │  │
│   │  type: SALE / REFUND                                                     │  │
│   │  parent_order_id: null (REFUND 时指向原 Order)                             │  │
│   │  merchant_id: M-ABC                                                      │  │
│   │  buyer_id: B-123                                                         │  │
│   │  amount: $100                                                            │  │
│   │  currency: USD                                                           │  │
│   │  status: CREATED / CONFIRMED / COMPLETED / CANCELLED / EXPIRED / REFUNDED│  │
│   │  payment_methods: [CARD, BANK_TRANSFER]                                  │  │
│   │  metadata: {order_ref, description}                                      │  │
│   │  created_at: 2024-01-15 10:00:00                                         │  │
│   │  expires_at: 2024-01-15 10:30:00                                         │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│         │                                                                       │
│         │ 1:N                                                                   │
│         ▼                                                                       │
│   Transaction（支付动作）                                                         │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  transaction_id: TXN-001                                                 │  │
│   │  order_id: ORD-001                                                       │  │
│   │  channel_status: PAID / CAPTURED / SETTLED / REFUNDED / ...        │  │
│   │  attempt: 1                                                              │  │
│   │  amount: $100                                                            │  │
│   │  payment_method: CARD                                                    │  │
│   │  failure_reason: null                                                    │  │
│   │  created_at: 2024-01-15 10:00:05                                         │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│         │                                                                       │
│         │ 1:N (CAPTURE 时触发 Clearing，生成多条 Balance Movement)                │
│         ▼                                                                       │
│   Balance Movement（资金账）                                                     │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  movement_id: MOV-001                                                    │  │
│   │  transaction_id: TXN-001                                                 │  │
│   │  order_id: ORD-001                                                       │  │
│   │  type: COLLECTION / FEE / RESERVE / REFUND / PAYOUT                     │  │
│   │  account: customer:abc:pending:USD                                       │  │
│   │  amount: +$100                                                           │  │
│   │  currency: USD                                                           │  │
│   │  created_at: 2024-01-15 10:00:05                                         │  │
│   ├──────────────────────────────────────────────────────────────────────────┤  │
│   │  movement_id: MOV-002                                                    │  │
│   │  transaction_id: TXN-001                                                 │  │
│   │  type: FEE                                                               │  │
│   │  account: revenue:platform:mdr:USD                                       │  │
│   │  amount: +$2.50                                                          │  │
│   │  created_at: 2024-01-15 10:00:05                                         │  │
│   ├──────────────────────────────────────────────────────────────────────────┤  │
│   │  movement_id: MOV-003                                                    │  │
│   │  transaction_id: TXN-001                                                 │  │
│   │  type: RESERVE                                                           │  │
│   │  account: customer:abc:reserve:rolling:USD                               │  │
│   │  amount: -$5.00                                                          │  │
│   │  created_at: 2024-01-15 10:00:05                                         │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│         │                                                                       │
│         │ 1:N                                                                   │
│         ▼                                                                       │
│   Ledger Entry（会计分录）                                                       │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │  entry_id: JNL-001                                                       │  │
│   │  movement_id: MOV-001                                                    │  │
│   │  entries:                                                                │  │
│   │    借  receivable:acquirer:USD     +$100                                 │  │
│   │    贷  payable:merchant:pending:USD +$100                                │  │
│   │  created_at: 2024-01-15 10:00:05                                         │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 关系说明

| 关系 | 比例 | 说明 |
|------|------|------|
| Order → Transaction | 1:N | 一个支付意图可以有多次支付尝试（重试、换卡） |
| Transaction → Balance Movement | 1:N | CAPTURE 时触发 Clearing，生成多条资金变动 |
| Balance Movement → Ledger Entry | 1:N | 每条资金变动对应一条或多条复式分录 |

## Order Type

| Type | 语义 | 关联关系 |
|------|------|----------|
| SALE | 收款（支付意图） | 无 parent_order_id |
| REFUND | 退款 | parent_order_id 指向原 SALE Order |

## 状态流转

### Transaction（渠道状态）

```
INIT → PAYING → PAID → CAPTURED → SETTLED
               ↘ CANCELED        ↘ REFUNDED
                        ↘ VOIDED ↗ REFUNDED_FULL
```

**注：** Transaction.status 直接存储渠道（acquirer）返回的状态，平台不做过滤或映射。

### Order（业务状态）

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      │
              ┌──────────┐                                 │
              │  CREATED  │                                │
              └────┬─────┘                                 │
                   │                                       │
          ┌────────┼────────┐                              │
          ▼        │        ▼                              │
    ┌──────────┐   │   ┌──────────┐                        │
    │ EXPIRED  │   │   │ CANCELLED│                        │
    └──────────┘   │   └──────────┘                        │
                   │                                       │
                   ▼                                       │
              ┌──────────┐                                 │
              │CONFIRMED │                                 │
              └────┬─────┘                                 │
                   │                                       │
                   │  Transaction 成功                      │
                   ▼                                       │
              ┌──────────┐                                 │
              │ COMPLETED│───────────────▶ REFUNDED        │
              └──────────┘                                 │
                                                           │
└──────────────────────────────────────────────────────────┘
```

### 状态映射

| Transaction（渠道） | Order（业务） | Balance Movement |
|---------------------|---------------|------------------|
| PAID (AUTHORIZED) | CONFIRMED | — |
| CAPTURED | COMPLETED | COLLECTION + FEE + RESERVE |
| SETTLED | — | SETTLEMENT |
| CANCELED | CANCELLED | — |
| VOIDED | CANCELLED | REVERSAL |
| REFUNDED | REFUNDED | REFUND |

## 数据量参考

| 概念 | 每笔支付的记录数 | 说明 |
|------|-----------------|------|
| Order | 1 | 一个支付意图 |
| Transaction | 1-3 | 通常 1 次成功，失败重试可能 2-3 次 |
| Balance Movement | 3-5 | COLLECTION + FEE + RESERVE + (SETTLEMENT) |
| Ledger Entry | 3-5 | 每条 Balance Movement 对应 1 条复式分录 |

## 示例：一笔完整的收款流程

```
1. 用户下单
   Order: ORD-001 (type=SALE, $100, status=CREATED)

2. 支付授权成功
   Transaction: TXN-001 (channel_status=PAID)
   Order: ORD-001 → CONFIRMED

3. Capture 成功，触发实时 Clearing
   Transaction: TXN-001 (channel_status=CAPTURED)
   Order: ORD-001 → COMPLETED

   Balance Movements:
     MOV-001: COLLECTION  customer:abc:pending:USD     +$100
     MOV-002: FEE         revenue:platform:mdr:USD     +$2.50
     MOV-003: FEE         revenue:platform:gateway:USD +$0.30
     MOV-004: RESERVE     customer:abc:reserve:rolling:USD -$5.00

   Ledger Entries:
     JNL-001: 借 receivable:acquirer:USD +$100 / 贷 payable:merchant:pending:USD +$100
     JNL-002: 借 merchant:pending:USD -$2.50 / 贷 revenue:platform:mdr:USD +$2.50
     ...

4. Acquirer 结算（T+1）
   Transaction: TXN-001 (channel_status=SETTLED)

   Balance Movement:
     MOV-005: SETTLEMENT  无额外变动（acquirer 到账确认）

5. 商户提现（T+7）
   Balance Movement:
     MOV-006: PAYOUT      customer:abc:available:USD -$92.20
                           bank:merchant:usd +$92.20
```
