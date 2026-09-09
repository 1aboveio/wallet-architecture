# 0005 账本与钱包不变量

从账户、流水、科目、信息流文档里抽出跨场景硬约束。收单清分、退款、保证金、多币种汇率分别见 0001–0004，这里不重复。

这些不变量改了就会串户、账不平、或上下游互相污染。T+2 / T+7、费率数字、科目叫 receivable 还是 clearing **不是**不变量。

## 钱包

1. **一个钱包，按币种分账。** 每个余额账户恰好一个 `{ccy}`。禁止在同一账户里混币。
2. **账户名嵌入归属。** `customer:{id}:{role}:{ccy}`。客户 ID 在路径里，物理隔离，不能靠字段过滤防串户。
3. **客户资金是负债。** `available` / `pending` / `frozen_hold` / `reserve:fixed` / `reserve:rolling` / `special_account`。平台银行是资产 `house:bank:{ccy}`。
4. **冻结是账户，不是状态。** 冻：从资金所在账户（pending 或 available）转入 `frozen_hold`；解冻：转回 available（或仍待结则回 pending）。必须有借贷，不能只打标。
5. **有余额的科目都带币种。** 含 `revenue:fee:*:{ccy}`、`expense:*:{ccy}`。跨币种只允许走显式换汇过渡（`clearing:fx:{from}_{to}`）。

来源：README 决策 1–3、`account-balance-design.md`。不采用：全客户共用 omnibus；冻结当 status 位。

## 账本

6. **复式、分币种平衡。** 一笔分录内每个币种借贷相等。EUR 与 USD 同时动，必须经 FX 过渡，不能一边 €、一边 $ 直接对敲。
7. **分录不可变。** 错账用反向分录冲，不改历史。每条含 account、direction、amount、currency、reference_id。
8. **账本是余额唯一真相源。** 缓存余额是投影，写入同步更新，带 `lock_version`。定期从分录重算，与缓存不一致以账本为准。

来源：PRD Ledger/Balance、`account-balance-design.md`。不采用：改余额不记账；用流水表当账本。

## 两本账

9. **上游与下游独立。** 收单行何时到账、扣多少 IC/scheme，只进上游费用；商户入账金额、MDR、保证金只按下游客约。互不驱动。

来源：README 决策 4、清算文档。与 0004「IC 只收录」同一条腿。

## 流水

10. **流水记事，账本记钱。** 用 `reference_id` 互指。客服查流水，财务查账本。流水不能替代分录，分录不存买家卡号。

来源：`transaction-log-design.md`。

## 明确不是不变量

| 项 | 处理 |
|---|---|
| T+2 / T+7 | 运营 SLA，可改 |
| 科目叫 `receivable` 还是 `clearing` | 命名，见 `chart-of-accounts-dual.md`；逻辑须同一套 |
| 日切 00:00 UTC、费率数字 | 0003 配置，不是账本结构 |
| 退款/保证金/汇率 | 0001 / 0002 / 0004 |

状态机、清分是过程不是实体：0003。
