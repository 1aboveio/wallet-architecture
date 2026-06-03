# 全球钱包平台

全球钱包平台产品架构与设计文档。

## 文档目录

### 收单业务（Acquiring）

| 文档 | 说明 |
|------|------|
| [收单信息流](docs/acquiring-information-flow.md) | Auth → Capture → Settle → Settle 全流程信息流 |
| [收单资金流](docs/acquiring-fund-flow.md) | 各环节资金走向和扣费明细 |
| [收单清算逻辑](docs/acquiring-settlement-clearing.md) | 面向商户的分层清算与记账分录 |
| [退款校验规则](docs/acquiring-refund-validation.md) | 防止资损的五条校验规则与负余额处理 |

## 业务模型

平台覆盖六大核心能力：

1. **多币种钱包余额** — 持有 USD、EUR、GBP 等余额
2. **全球本地收款账户** — 各国本地银行账号
3. **跨境付款（Payout）** — 向海外供应商付款
4. **换汇（FX）** — 用户自主决定何时换汇
5. **收单（Acquiring）** — 接受终端消费者付款
6. **支付 API** — 商户集成收款能力

## 客户画像

- 主要客户：跨境电商卖家
- 主体所在地：香港为主，兼容中国大陆
- 支持平台：Amazon、TikTok Shop 等
