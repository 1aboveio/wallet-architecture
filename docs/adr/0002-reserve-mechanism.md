# 0002 保证金机制设计

支持固定保证金（Fixed Reserve）和滚动保证金（Rolling Reserve）两种模式，可同时存在于同一商户，同一笔交易可同时扣两种。多币种下滚动留在该笔结算币种、固定目标在主币种，见 [ADR 0004](0004-multi-currency-clearing.md)。分录见 [journals/reserve.md](../journals/reserve.md)。

## 核心规则

1. 每笔交易可以同时扣固定保证金**和/或**滚动保证金
2. 两种保证金可以同时存在于同一商户的不同账户
3. 滚动保证金可**升级**为固定保证金，固定保证金不可降级为滚动保证金
4. 滚动按**入账金额**百分比扣除；固定按入账剩余折**主币种**后扣除，目标金额在主币种
5. 固定保证金：如果扣除手续费后剩余余额不足，按剩余金额全额扣
   滚动保证金：如果扣除手续费后剩余余额不足，按入账金额百分比扣除，可能导致结算余额为负
6. 保证金比率与 MDR 独立配置，不做交叉校验
7. 扣除顺序：MDR → 按笔费 → 滚动保证金 → 固定保证金

## 账户结构

```
customer:{id}:reserve:fixed:{ccy}       ← 固定保证金
customer:{id}:reserve:rolling:{ccy}     ← 滚动保证金
customer:{id}:special_account:{ccy}     ← 充值专户（用于固定保证金充值）
```

## 扣除逻辑

```
入账金额 → 扣 MDR → 扣按笔费 → 扣滚动保证金 → 扣固定保证金 → 结算净额
```

固定：

```
按百分比应扣 = 入账金额 × 固定保证金比率（结算币种 ≠ 主币种时折主币种）
剩余余额 = 入账金额 - MDR - 按笔费 - 滚动保证金
实际扣除 = min(按百分比应扣, 主币种目标差额, 剩余余额折主币种)

IF 剩余余额 <= 0 或 目标差额 == 0
  → 不扣固定保证金
```

封顶保护，不会因固定保证金导致结算余额为负。

滚动：

```
实际扣除 = 入账金额 × 滚动保证金比率（不封顶）
账户: reserve:rolling:{settlement_currency}
```

扣除后结算余额可以为负。

## 固定保证金

累计到**主币种**目标后停止。释放手动，回到 `available:{primary_currency}`。

| 操作 | 资金路径 | 触发 |
|------|----------|------|
| 累计（清分扣除） | 结算剩余 → `reserve:fixed:{primary}` | 每笔 CAPTURE 清分 |
| 累计（充值） | `special_account:{primary}` → fixed | 商户充值 |
| 释放 | fixed → `available:{primary}` | 手动 |

退款不调整固定保证金。

## 滚动保证金

记入 `reserve:rolling:{settlement_currency}`，N 天后释放到同币种 available。无目标上限。

| 操作 | 资金路径 | 触发 |
|------|----------|------|
| 累计 | 入账 → rolling | 每笔清分 |
| 释放 | rolling → available（同币种） | N 天后 |
| 升级 | rolling → fixed | 手动，仅主币种全额 |

升级约束：

- 只升级 `reserve:rolling:{primary}` → `reserve:fixed:{primary}`
- 全额、不经过 available、无 FX
- 不允许把 EUR rolling 兑成 USD fixed
- entries → `RESERVE_RELEASED`

退款：仅 `HELD` 按请款比例退回；`RELEASED` / `RESERVE_RELEASED` 不退。分录见 [journals/acquiring.md](../journals/acquiring.md)。

不经过 available 的原因：避免假可用中间态；升级是保证金搬家。

## 资金路径

```
pending ──清分──▶ rolling:{settlement}
              └─▶ fixed:{primary}     （折主币种）
              └─▶ available:{settlement}

special:{primary} ──充值──▶ fixed:{primary}
fixed:{primary}   ──手动释放──▶ available:{primary}
rolling:{ccy}     ──到期──▶ available:{ccy}
rolling:{primary} ──升级──▶ fixed:{primary}
```

## 对比

| 维度 | 固定 | 滚动 |
|------|------|------|
| 扣除 | 入账百分比，折主币种 | 入账百分比，留结算币种 |
| 目标 | 有上限 | 无上限 |
| 余额不足 | 封顶 | 不封顶（可负） |
| 释放 | 手动 → primary available | N 天 → 同币种 available |
| 退款 | 不退 | 请款比例，仅 HELD |
| 升级 | — | 仅 primary 同币直转 |

## 选择规则（示例）

```
IF 风险高 OR 拒付率超阈值
  → 滚动（比率 10%, 窗口 180 天）
ELSE IF 开户 < 90 天
  → 固定（目标 $500, 比率 5%）
ELSE
  → 固定（目标 $300, 比率 3%）
```

## 运行时风控

比率与 MDR 不做交叉校验。监控：

```
连续 N 笔 available 为负 → 告警，可冻新交易
available < -阈值 → 冻出金，要求 special_account 充值进 fixed
```
