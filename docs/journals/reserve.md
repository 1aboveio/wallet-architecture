# 保证金分录

规则见 [ADR 0002](../adr/0002-reserve-mechanism.md)。多币种见 [ADR 0004](../adr/0004-multi-currency-clearing.md) 与 [acquiring.md](acquiring.md)。

---

## 同时扣滚动 + 固定

入账 $100，MDR 1%，滚动 5%，固定 3%。

```
  借  customer:abc:pending:USD               -$100.00
  贷  customer:abc:available:USD             +$91.00
  贷  customer:abc:reserve:rolling:USD       +$5.00
  贷  customer:abc:reserve:fixed:USD         +$3.00
  贷  revenue:fee:acquiring:USD              +$1.00
```

## 固定封顶（剩余不足）

MDR 10%，滚动 5%，固定 95%。滚动先扣 $5，剩余 $85，固定应扣 $95 → 实扣 $85。

```
  借  customer:abc:pending:USD               -$100.00
  贷  customer:abc:available:USD             +$0.00
  贷  customer:abc:reserve:rolling:USD       +$5.00
  贷  customer:abc:reserve:fixed:USD         +$85.00
  贷  revenue:fee:acquiring:USD              +$10.00
```

## 仅滚动（不封顶）

滚动 95%。

```
  借  customer:abc:pending:USD               -$100.00
  贷  customer:abc:available:USD             +$4.00
  贷  customer:abc:reserve:rolling:USD       +$95.00
  贷  revenue:fee:acquiring:USD              +$1.00
```

## 仅固定（目标差额）

目标 $500，已累计 $480，比率 5%。应扣 $5 < 差额 $20 → 扣 $5。

```
  借  customer:abc:pending:USD               -$100.00
  贷  customer:abc:available:USD             +$94.00
  贷  customer:abc:reserve:fixed:USD         +$5.00
  贷  revenue:fee:acquiring:USD              +$1.00
```

## 充值专户转入固定

```
  借  customer:abc:special_account:USD       -$300.00
  贷  customer:abc:reserve:fixed:USD         +$300.00
```

## 固定手动释放

回到 `available:{primary}`。

```
  借  customer:abc:reserve:fixed:USD         -$500.00
  贷  customer:abc:available:USD             +$500.00
```

## 滚动到期释放

同币种，先冲该币种负 available。

```
  借  customer:{id}:reserve:rolling:{ccy}    -amount
  贷  customer:{id}:available:{ccy}          +amount
```

## 升级：仅主币种 rolling → fixed

不允许 EUR rolling 兑成 USD fixed。

```
  借  customer:abc:reserve:rolling:USD       -$200.00
  贷  customer:abc:reserve:fixed:USD         +$200.00
```

entries：`HELD` → `RESERVE_RELEASED`。不经过 available。
