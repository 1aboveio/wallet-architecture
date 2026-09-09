# 0003 交易状态模型

交易状态流转的核心决策，定义了从交易创建到终态的完整生命周期，以及各层实体的关系。

## 分层模型

```
Transaction（动作）→ Order（状态）
                     ↓ CAPTURE 时触发 Clearing（过程）
                   Balance Movement（资金账）→ Ledger Entry（会计分录）
```

| 层级 | 概念 | 类型 | 说明 |
|------|------|------|------|
| Transaction | 支付动作 | Entity | 渠道返回的状态变更 |
| Order | 支付意图 | Entity | 业务状态，区分 SALE/REFUND |
| Clearing | 清分 | Process | CAPTURE 时实时计算，不入库 |
| Balance Movement | 资金变动 | Entity | 记录每一笔余额变动 |
| Ledger Entry | 会计分录 | Entity | 复式记账（借/贷） |

详见 [Order - Transaction - Balance Movement - Ledger Entry 关系图](../order-transaction-booking-er.md)。

---

## Transaction 状态

Transaction 表直接存储渠道（acquirer）返回的状态，平台不做过滤或映射。

### 状态定义

| 状态 | 语义 | 进入条件 |
|------|------|----------|
| INIT | 交易创建，尚未提交 | 交易初始化 |
| PAYING | 已提交到 acquirer，等待响应 | 发起支付请求 |
| PAID | 授权成功，资金冻结（= 传统收单的 AUTHORIZED） | acquirer 返回授权成功 |
| CAPTURED | 请款成功；清分完成，**结算净额留在 pending**，不可提现 | 系统 capture 成功 |
| SETTLED | 下游批次完成：pending 净额转入 available；退款闸门打开 | 平台下游结算。不是收单行到账 |
| DISPUTED | 争议/拒付进行中 | 只从 SETTLED / REFUNDED 进入，不能从 CAPTURED |
| DISPUTE_WON | 争议胜诉 | 解冻争议金额 |
| DISPUTE_LOST | 争议败诉 | 从冻结/滚动/钱包扣败诉额 |
| CANCELED | Auth Reversal | capture 前取消 |
| VOIDED | Capture Reversal | CAPTURED 之后、SETTLED 之前撤销 |
| REFUNDED | 部分退款，**可继续退** | 从 SETTLED 或 REFUNDED 发起 |
| REFUNDED_FULL | 全额退款，终态 | 从 SETTLED 或 REFUNDED 退完 |

### 状态流转图

```
INIT → PAYING → PAID → CAPTURED → SETTLED → REFUNDED → REFUNDED_FULL
                 ↘ CANCELED               ↘ DISPUTED → DISPUTE_WON
                          ↘ VOIDED                     ↘ DISPUTE_LOST
```

CANCELED 只从 PAID；VOIDED 只从 CAPTURED（SETTLED 前）。
DISPUTED 只从 SETTLED / REFUNDED 进入，不能从 CAPTURED。SETTLED 前的通道争议走 VOID 或上游调账。
上游收单行打款记 Movement `SETTLEMENT`，不占用 `Transaction.SETTLED`。

---

## Order 状态

Order 区分类型：SALE（收款）和 REFUND（退款）。REFUND 类型通过 parent_order_id 关联原 SALE Order。

### 状态定义

| 状态 | 语义 | 进入条件 |
|------|------|----------|
| CREATED | 支付意图已创建 | 创建 Order |
| CONFIRMED | 用户已确认支付方式 | 用户确认 |
| COMPLETED | 支付成功 | Transaction 进入 CAPTURED |
| CANCELLED | 主动取消 | 取消请求 |
| EXPIRED | 超时未支付 | 超过 expires_at |
| REFUNDED | 已退款 | Transaction 进入 REFUNDED |

### 状态流转图

```
              ┌──────────┐
              │  CREATED  │
              └────┬─────┘
                   │
          ┌────────┼────────┐
          ▼        │        ▼
    ┌──────────┐   │   ┌──────────┐
    │ EXPIRED  │   │   │ CANCELLED│
    └──────────┘   │   └──────────┘
                   ▼
              ┌──────────┐
              │CONFIRMED │
              └────┬─────┘
                   ▼
              ┌──────────┐
              │ COMPLETED│───────────────▶ REFUNDED
              └──────────┘
```

### Transaction ↔ Order 状态映射

| Transaction（渠道） | Order（业务） |
|---------------------|---------------|
| PAID | CONFIRMED |
| CAPTURED | COMPLETED |
| SETTLED | COMPLETED |
| CANCELED | CANCELLED |
| VOIDED | CANCELLED |
| REFUNDED | REFUNDED |
| REFUNDED_FULL | REFUNDED |
| DISPUTED | COMPLETED 或 REFUNDED |

---

## 决策 1：不需要 CAPTURING 中间状态

Capture 是系统侧操作（对 acquirer 的 API 调用），不需要让用户感知中间状态。`PAID` 直接变为 `CAPTURED`，如果 capture 失败则保持 `PAID` 状态，等待重试或 auth 自然过期。

### 理由

1. **简化模型** — 减少一个状态，降低状态机复杂度
2. **用户无感** — Capture 是后台操作，用户不需要知道"正在 capture"
3. **重试友好** — 失败后保持 PAID，商户可以重试，auth 过期后自动失效

## 决策 2：PAID 等价于传统收单的 AUTHORIZED

使用 `PAID` 而非 `AUTHORIZED` 作为命名，与业务语义更贴合。`PAYING` 覆盖了"已提交但未收到响应"的窗口。

### 理由

1. **业务语义** — "已支付"比"已授权"更符合用户直觉
2. **覆盖中间态** — `PAYING` 明确表示"处理中"，避免歧义

## 决策 3：CANCELED 和 VOIDED 按时机区分

- **CANCELED**：capture 前，撤销 auth，解冻用户资金
- **VOIDED**：capture 后、settlement 前，撤销 capture

### 理由

1. **时机明确** — 两个状态的分界线是 capture，清晰无歧义
2. **对账清晰** — CANCELED 不产生资金流动，VOIDED 需要处理资金回退
3. **行业惯例** — 对应传统收单的 Auth Reversal 和 Void

## 决策 4：退款只能从 SETTLED 发起

退款只能从 `SETTLED` 或 `REFUNDED`（未退完）进入，不能从 `CAPTURED`。全额后退入 `REFUNDED_FULL`。

### 理由

1. **资金归属清晰** — 只有结算后的资金才属于商户，退款从商户 available 扣减
2. **避免歧义** — settlement 前的撤销统一走 VOIDED，不走退款流程
3. **对账简单** — 退款和结算挂钩，财务处理更清晰

## 决策 5：REFUNDED 支持部分退款

- **REFUNDED**：部分退款，交易仍可继续退款（直到退完）
- **REFUNDED_FULL**：全额退款，交易进入终态，不再接受新退款

### 理由

1. **业务灵活** — 支持多次部分退款，满足复杂退款场景
2. **状态明确** — REFUNDED_FULL 明确标识"已退完"，避免重复退款校验

## 决策 5b：争议与退款分开

拒付/争议不是退款。退款是商户发起；争议是发卡行/卡组发起。**必须已经 SETTLED**（或已部分退款的 REFUNDED）才能进 `DISPUTED`。CAPTURED、钱还在 pending 时不走争议态。

- **进行中：** 按争议请款金额折结算币，从 **available** 划入 `frozen_hold`。不退 MDR、不退按笔费。
- **胜诉：** 冻结划回原账户。
- **败诉：** 先用该笔滚动 HELD，再扣 `frozen_hold`，再 `available:{S}`，再主币种兜底。滚动是拿来挡拒付的，败诉不退给商户。
- 可另扣争议手续费（主币种标价，扣法同按笔费）。

分录见 [journals/acquiring.md](../journals/acquiring.md) 节 H。

## 决策 6：费率按 CAPTURE 日期生效

费率以 CAPTURE（扣款确认）日期为准，而非 PAID（授权）日期。

### 理由

1. **交易确定性** — PAID 只是冻结资金，CAPTURE 才是交易真正成立
2. **对账简单** — 费率与结算周期对齐，避免跨期差异
3. **可预期** — 商户知道 capture 当天的费率，不会因授权和扣款跨日产生歧义

### 日切规则

- **日切时间**：00:00 UTC
- **生效逻辑**：费率调整后，从下一个 00:00 UTC 开始对新 CAPTURE 的交易生效
- **锁定时点**：交易在 CAPTURE 时按当天费率锁定，后续不再变动

## 决策 7：费率配置模型

费率按商户维度配置，支持百分比 + 按笔固定费用的组合结构。

### 配置维度

| 维度 | 说明 |
|------|------|
| 商户 | 每个商户独立费率协议 |
| 费率结构 | 百分比（MDR）+ 按笔固定费用 |
| 保底/封顶 | 商户月度手续费总额的兜底机制 |

### 费率组成

| 费用项 | 说明 | 退款时处理 |
|--------|------|-----------|
| MDR（百分比） | 按请款金额的百分比计价，扣结算币种 | 按请款比例退给商户 |
| 按笔固定费用 | 网关费、3DS 等，主币种标价，扣结算币种 | 不退 |
| 退款手续费 | 退款发起时另扣，主币种标价 | N/A |

跨币种折算与退款即期汇率见 [ADR 0004](0004-multi-currency-clearing.md)。

### 保底与封顶

商户维度的月度费用兜底机制：

- **保底**：商户当月手续费总额低于保底值时，按保底值收取
- **封顶**：商户当月手续费总额超过封顶值时，按封顶值收取

这是结算层面的配置，与单笔交易费用独立。

### 阶梯定价

暂不实现。后续可按月累计交易笔数和金额设置阶梯费率。

## 决策 8：实时清分

Clearing 是一个计算过程，在交易 CAPTURE 时立即触发，不是独立实体，不单独入库。

### 触发时机

```
Transaction: PAID → CAPTURED
                ↓
        触发 Clearing（过程）
                ↓
        生成 Balance Movements:
          - COLLECTION: 商户 pending +$100
          - FEE: 平台收入 +$2.50
          - RESERVE: 保证金 -$5.00
```

### 与 Settlement 的关系

实时清分 ≠ 实时结算。清分是平台内部的计算，结算依赖 acquirer 的资金划转。

| 环节 | 时机 | 说明 |
|------|------|------|
| CAPTURE | 实时 | 交易扣款确认 |
| Clearing | 实时（CAPTURE 时） | 费用计算，生成 Balance Movement |
| 上游 SETTLEMENT movement | T+1/T+2 | acquirer 资金到账，不是 Transaction.SETTLED |
| Transaction.SETTLED | 下游批次 | 退款闸门；不再记商户费用 |

### 理由

1. **商户体验** — CAPTURE 后立即看到费用和净额，无需等待日切
2. **实时性** — 余额实时更新，支持实时查询
3. **简化逻辑** — 无需维护日切批次状态，减少定时任务
4. **无需入库** — Clearing 是过程，输出是 Balance Movement，不产生额外记录

## 决策 9：渠道原始码与平台 SETTLED 分开

渠道返回码写入 `channel_raw_status`。平台 `Transaction.status` 用上表枚举。`SETTLED` 专指**下游商户结算完成**，不是 acquirer 银行到账。

上游到账：Balance Movement 类型 `SETTLEMENT`（`house:bank` / `clearing:acquiring`），与能否退款无关。

## 决策 10：Order 区分 SALE 和 REFUND

Order 通过 type 字段区分收款和退款，REFUND 类型通过 parent_order_id 关联原 SALE Order。

### 理由

1. **统一模型** — 收款和退款都是 Order，简化查询和管理
2. **关联清晰** — parent_order_id 明确退款的来源
3. **对账友好** — 一个 SALE Order 下的所有 REFUND Order 一目了然

### 数据结构

```
SALE Order:
  order_id: ORD-001
  type: SALE
  parent_order_id: null
  amount: $100

REFUND Order:
  order_id: ORD-002
  type: REFUND
  parent_order_id: ORD-001  ← 关联原单
  amount: $30
```
