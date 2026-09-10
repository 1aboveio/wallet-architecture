# 全球钱包平台 — 产品架构与设计文档

跨境电商卖家的多币种钱包：收单、收款、换汇、提现。主体以香港为主。

**怎么读：** [词](CONTEXT.md) → [ADR](docs/adr/) → [分录](docs/journals/)。冲突时以 ADR 为准。

## 资金时点

```
CAPTURE  请款 + 清分（MDR / 按笔费 / 保证金）
         结算净额留在 pending，不可提现、不可退款、不可进争议
SETTLED  pending → available；此后可提现、可退款、可进 DISPUTED
VOID     仅 CAPTURED → SETTLED 之前，冲原清分
退款     SETTLED 或未退完的 REFUNDED；从 available，不足扣主币种
争议     只从 SETTLED / REFUNDED；不能从 CAPTURED
```

上游收单行到账是另一本账（`clearing:acquiring` → `house:bank`），不占用 `Transaction.SETTLED`。

## 四币

| 词 | 字段 | 干什么 |
|---|---|---|
| 请款币种 | `presentment_currency` | 买家被扣、卡组交易币 |
| 结算币种 | `settlement_currency` | 开通则原币入 pending；否则兑主币种 |
| 主币种 | `primary_currency` | 按笔费标价、固定保证金、未开通币落点、退款兜底。香港 ∈ {HKD, USD} |
| 上游结算币种 | `channel_settlement_currency` | IC/scheme 按通道文件原样记 |

CAPTURE 用 `booking_fx_rate`（请款→结算）换汇入账，不是锁汇。退款用 `refund_fx_rate`（请款→结算，即期）。结算钱包不够时用 `fallback_fx_rate`（结算→主币种）。报表用 `report_fx_rate`（报表日 UTC 日终），接受翻译损益。

## 权威文档

| 文档 | 说明 |
|------|------|
| [CONTEXT.md](CONTEXT.md) | 词 |
| [0001 退款](docs/adr/0001-refund-logic.md) | 覆盖口径、主币种兜底、负余额 |
| [0002 保证金](docs/adr/0002-reserve-mechanism.md) | 滚动在结算币种；固定在主币种；只升主币种 |
| [0003 状态](docs/adr/0003-transaction-status-model.md) | SETTLED 闸门；DISPUTED；VOID |
| [0004 多币种清分](docs/adr/0004-multi-currency-clearing.md) | 入账/退款/兜底汇率；按笔费扣结算腿 |
| [0005 不变量](docs/adr/0005-ledger-invariants.md) | 一币一账、冻结即账户、分币种平衡 |
| [0006 科目](docs/adr/0006-chart-of-accounts.md) | `clearing:*` 在途 + `customer:*` 负债 |
| [0007 报价与报表](docs/adr/0007-quote-and-reporting.md) | Quote 入出参；报表日折主币种 |
| [journals](docs/journals/) | [收单](docs/journals/acquiring.md) · [保证金](docs/journals/reserve.md) · [收款](docs/journals/collection.md) · [换汇](docs/journals/fx.md) · [提现](docs/journals/payout.md) · [冻结](docs/journals/freeze.md) |
| [PRD](docs/prd/prd-payment-ledger.md) | 产品需求 |

## 实现稿（不是第二套规则）

| 文档 | 说明 |
|------|------|
| [账户与余额](docs/account-balance-design.md) | 命名、缓存、乐观锁、对账 |
| [科目对照](docs/chart-of-accounts-dual.md) | 旧对照；规范名见 0006 |
| [实体关系](docs/order-transaction-booking-er.md) | Order / Transaction / Movement |
| [流水账](docs/transaction-log-design.md) | 六类流水表 |
| [行业引用](docs/industry-references.md) | 外部资料 |

历史叙述在 [docs/archive/](docs/archive/)，不要当现行规则。

## 核心决策

| # | 决策 | 选择 |
|---|------|------|
| 1 | 钱包 | 一个钱包，多币种子余额（0005） |
| 2 | 账户名 | `customer:{id}:{role}:{ccy}`（0005） |
| 3 | 冻结 | `frozen_hold` 划转，不是状态（0005） |
| 4 | 上下游 | 两本账；IC 只收录（0004 / 0005） |
| 5 | pending | CAPTURE 净额在 pending；SETTLED 才 available（0003 / 0004） |
| 6 | 退款 | SETTLED 或未退完的 REFUNDED；先 available:{S} 再主币种（0001） |
| 7 | 争议 | 不可从 CAPTURED 进入（0003） |
| 8 | 保证金 | 滚动跟结算币；固定跟主币种；升级仅主币种同币（0002） |
| 9 | 按笔费 | 主币种标价，从该笔 pending/结算腿扣（0004） |
| 10 | 科目 | `clearing:acquiring` 等，不用 `receivable:txn`（0006） |
| 11 | 报价 | Quote `indicative` / `capture`；IC 不进净额（0007） |
| 12 | 报表 | 报表日折主币种，接受汇率波动（0007） |
