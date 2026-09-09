# 全球钱包平台 — 产品架构与设计文档

规则以 ADR 为准，词以 [CONTEXT.md](CONTEXT.md) 为准，分录以 [docs/journals/](docs/journals/) 为准。

## 怎么读

1. [CONTEXT.md](CONTEXT.md) — 词  
2. [docs/adr/](docs/adr/) — 决定了什么  
3. [docs/journals/](docs/journals/) — 怎么记账  

## 权威文档

| 文档 | 说明 |
|------|------|
| [CONTEXT.md](CONTEXT.md) | 请款 / 入账 / 结算币种 / 主币种 / 入账汇率 / 退款汇率 / 兜底汇率 |
| [ADR 0001](docs/adr/0001-refund-logic.md) | 退款资金、主币种兜底、负余额 |
| [ADR 0002](docs/adr/0002-reserve-mechanism.md) | 固定 / 滚动保证金 |
| [ADR 0003](docs/adr/0003-transaction-status-model.md) | 状态机；SETTLED 是下游退款闸门 |
| [ADR 0004](docs/adr/0004-multi-currency-clearing.md) | 多币种清分、CAPTURE 换汇、退款即期 |
| [ADR 0005](docs/adr/0005-ledger-invariants.md) | 钱包隔离、冻结即账户、分币种平衡 |
| [ADR 0006](docs/adr/0006-chart-of-accounts.md) | 科目：clearing 在途 + customer 负债 |
| [ADR 0007](docs/adr/0007-quote-and-reporting.md) | 报价契约；报表按报表日折主币种 |
| [分录手册](docs/journals/) | 收单 / 保证金 / 收款 / 换汇 / 提现 / 冻结 |
| [PRD](docs/prd/prd-payment-ledger.md) | 产品需求 |

## 仍在用的实现/模型稿

| 文档 | 说明 |
|------|------|
| [账户与余额](docs/account-balance-design.md) | 命名、缓存、乐观锁、对账 |
| [科目双视角](docs/chart-of-accounts-dual.md) | 对照稿；规范名见 ADR 0006 |
| [Order / Transaction / Movement](docs/order-transaction-booking-er.md) | 实体关系 |
| [流水账](docs/transaction-log-design.md) | 六类流水表 |
| [行业引用](docs/industry-references.md) | 外部资料 |

历史叙述（清算/信息流/整本复式分录等）在 [docs/archive/](docs/archive/)，**不要当现行规则**。

## 核心设计决策

| # | 决策 | 选择 |
|---|------|------|
| 1 | 钱包架构 | 一个钱包，多币种子余额（ADR 0005） |
| 2 | 账户命名 | 客户 ID 嵌入账户名（ADR 0005） |
| 3 | 冻结 | 账户 `frozen_hold`，非状态（ADR 0005） |
| 4 | 上下游 | 两本独立的账（ADR 0005） |
| 5 | 出金 / 退款 / 争议 | SETTLED 前净额在 pending、不可提现。退款与 DISPUTED 都须已 SETTLED（ADR 0003） |
| 6 | 保证金 | 滚动按入账、到期释放；固定在主币种、手动释放（ADR 0002） |
| 7 | 负余额 | 先结算钱包再主币种；同币种后续收入抵扣（ADR 0001） |
| 8 | 余额 | 缓存 + 乐观锁；账本为真相源（ADR 0005） |

## 客户画像

- **主要客户：** 跨境电商卖家
- **主体所在地：** 香港为主，兼容中国大陆
- **支持平台：** Amazon、TikTok Shop 等主流跨境电商平台
