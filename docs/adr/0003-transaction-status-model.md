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
| CAPTURED | Capture 确认，资金归属到平台 | 系统执行 capture 成功 |
| SETTLED | 结算完成，资金归属到商户 | 结算批次处理完成 |
| CANCELED | Auth Reversal，撤销授权 | capture 前发起取消 |
| VOIDED | Capture Reversal，撤销 capture | settlement 前发起撤销 |
| REFUNDED | 部分退款，可继续退 | 从 SETTLED 发起部分退款 |
| REFUNDED_FULL | 全额退款，终态 | 从 SETTLED 发起全额退款 |

### 状态流转图

```
INIT → PAYING → PAID → CAPTURED → SETTLED → REFUNDED (部分，可继续退)
               ↘ CANCELED                      ↘ REFUNDED_FULL (全额，终态)
                        ↘ VOIDED
```

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
| CANCELED | CANCELLED |
| VOIDED | CANCELLED |
| REFUNDED | REFUNDED |

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

退款（REFUNDED / REFUNDED_FULL）只能从 `SETTLED` 状态进入，不能从 `CAPTURED`。

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
| MDR（百分比） | 按交易金额的百分比收取 | 退给商户 |
| 按笔固定费用 | 网关费、3DS 等，按笔收取 | 不退 |
| 退款手续费 | 退款发起时另扣，单独配置 | N/A |

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
| Settlement | T+1/T+2（acquirer 周期） | acquirer 资金到账 |

### 理由

1. **商户体验** — CAPTURE 后立即看到费用和净额，无需等待日切
2. **实时性** — 余额实时更新，支持实时查询
3. **简化逻辑** — 无需维护日切批次状态，减少定时任务
4. **无需入库** — Clearing 是过程，输出是 Balance Movement，不产生额外记录

## 决策 9：Transaction 存渠道状态

Transaction 表直接存储渠道（acquirer）返回的状态，平台不做过滤或映射。

### 理由

1. **一致性** — 与渠道状态保持一致，减少映射错误
2. **可追溯** — 任何状态变更都能追溯到渠道原始返回
3. **调试友好** — 排查问题时直接对比渠道状态

### 注意事项

- 渠道状态可能与平台状态不一致（如渠道报 SETTLED 但平台未收到资金）
- 需要对账机制定期校验渠道状态与实际资金流水

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
