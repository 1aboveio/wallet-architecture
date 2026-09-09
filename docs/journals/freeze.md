# 冻结 / 解冻分录

冻结是账户划转，不是状态位（ADR 0005）。从资金所在账户转入 `frozen_hold`。

CAPTURE 清分后净额已在 available 时，从 available 冻：

```
  借  customer:abc:available:USD          -$50.00
  贷  customer:abc:frozen_hold:USD        +$50.00
```

解冻回 available：

```
  借  customer:abc:frozen_hold:USD        -$50.00
  贷  customer:abc:available:USD          +$50.00
```

若冻的是尚未清分的 pending，解冻可回 pending。
