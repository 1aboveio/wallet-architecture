# 全球钱包平台 — 产品架构与设计文档

全球钱包平台产品架构设计，覆盖收单、收款、换汇、提现等核心支付场景的记账逻辑与风控规则。

**怎么读：** [词](CONTEXT.md) → [ADR](docs/adr/) → [分录](docs/journals/)。冲突时以 ADR 为准。

## 客户画像

- **主要客户：** 跨境电商卖家
- **主体所在地：** 香港为主，兼容中国大陆
- **支持平台：** Amazon、TikTok Shop 等主流跨境电商平台

## 业务模型

```
┌─────────────────────────────────────────────────────┐
│                    客户层 (Customer)                  │
│  开户 · KYC · 账户管理 · 权限                         │
├─────────────────────────────────────────────────────┤
│                    钱包层 (Wallet)                    │
│  多币种余额 · available / pending / frozen / reserve  │
├─────────────────────────────────────────────────────┤
│                    资金流动层 (Flow)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ 收款      │  │ 收单      │  │ 换汇      │           │
│  │ Collection│  │ Acquiring│  │ FX       │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│  ┌──────────┐  ┌──────────┐                          │
│  │ 付款      │  │ 提现      │                          │
│  │ Payout   │  │ Withdraw │                          │
│  └──────────┘  └──────────┘                          │
├─────────────────────────────────────────────────────┤
│                    账本层 (Ledger)                    │
│  复式记账 · 双重校验 · 不可变分录                       │
├─────────────────────────────────────────────────────┤
│                    合规层 (Compliance)                │
│  KYC · AML · 制裁筛查 · 交易监控 · 风控冻结            │
├─────────────────────────────────────────────────────┤
│                    基础设施层 (Infrastructure)         │
│  银行通道 · 支付网络 · API · Webhook                  │
└─────────────────────────────────────────────────────┘
```

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

## 核心设计决策

| # | 决策 | 选择 |
|---|------|------|
| 1 | 钱包架构 | 一个钱包，多币种子余额（ADR 0005） |
| 2 | 账户命名 | `customer:{id}:{role}:{ccy}`，物理隔离（ADR 0005） |
| 3 | 冻结机制 | 冻结作为账户 `frozen_hold`，非状态标记（ADR 0005） |
| 4 | 上下游关系 | 上游结算与下游结算是独立事件（ADR 0005） |
| 5 | pending / 出金 | CAPTURE 净额在 pending；SETTLED 才进 available（ADR 0003 / 0004） |
| 6 | 退款 | SETTLED 或未退完的 REFUNDED；先 available:{S} 再主币种（ADR 0001） |
| 7 | 争议 | 不可从 CAPTURED 进入（ADR 0003） |
| 8 | 保证金 | 滚动跟结算币、到期释放；固定跟主币种、手动释放；升级仅主币种（ADR 0002） |
| 9 | 按笔费 | 主币种标价，从该笔 pending/结算腿扣（ADR 0004） |
| 10 | 科目 | `clearing:*` 在途 + `customer:*` 负债（ADR 0006） |
| 11 | 报价 | Quote `indicative` / `capture`；IC 不进净额（ADR 0007） |
| 12 | 报表 | 报表日折主币种，接受汇率波动（ADR 0007） |
| 13 | 余额计算 | 缓存 + 乐观锁；账本为真相源（ADR 0005） |

## 文档目录

### 权威

| 文档 | 说明 |
|------|------|
| [CONTEXT.md](CONTEXT.md) | 请款 / 入账 / 结算币种 / 主币种 / 入账汇率 / 退款汇率 / 兜底汇率 / 报表汇率 |
| [0001 退款](docs/adr/0001-refund-logic.md) | 覆盖口径、主币种兜底、负余额 |
| [0002 保证金](docs/adr/0002-reserve-mechanism.md) | 滚动在结算币种；固定在主币种 |
| [0003 状态](docs/adr/0003-transaction-status-model.md) | SETTLED 闸门；DISPUTED；VOID |
| [0004 多币种清分](docs/adr/0004-multi-currency-clearing.md) | 入账/退款/兜底汇率；按笔费 |
| [0005 不变量](docs/adr/0005-ledger-invariants.md) | 一币一账、冻结即账户、分币种平衡 |
| [0006 科目](docs/adr/0006-chart-of-accounts.md) | `clearing:*` 在途 + `customer:*` 负债 |
| [0007 报价与报表](docs/adr/0007-quote-and-reporting.md) | Quote 入出参；报表日折主币种 |
| [journals](docs/journals/) | [收单](docs/journals/acquiring.md) · [保证金](docs/journals/reserve.md) · [收款](docs/journals/collection.md) · [换汇](docs/journals/fx.md) · [提现](docs/journals/payout.md) · [冻结](docs/journals/freeze.md) |
| [PRD](docs/prd/prd-payment-ledger.md) | 产品需求 |

### 账户与模型

| 文档 | 说明 |
|------|------|
| [账户体系与余额设计](docs/account-balance-design.md) | 账户命名、缓存余额、乐观锁、定期对账 |
| [账户设计双视角](docs/chart-of-accounts-dual.md) | Receivable vs Clearing 对照；规范名见 ADR 0006 |
| [Order / Transaction / Movement](docs/order-transaction-booking-er.md) | 支付意图、渠道动作、资金账、会计分录 |
| [流水账设计](docs/transaction-log-design.md) | 流水与账本的关系、六类流水表 |
| [行业引用](docs/industry-references.md) | 外部资料 |
| [Hosted payment page research](docs/hosted-payment-page-research.md) | 托管支付页功能、商户集成建议与来源；研究建议，非现行 ADR |

历史叙述（清算长文、信息流、整本复式分录等）在 [docs/archive/](docs/archive/)，**不要当现行规则**。
