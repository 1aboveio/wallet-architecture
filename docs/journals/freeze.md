# 冻结 / 解冻分录

冻结是账户划转，不是状态位（ADR 0005）。从资金所在账户转入 `frozen_hold`。

SETTLED 前净额在 pending，从 pending 冻：

```
  借  customer:abc:pending:USD            -$50.00
  贷  customer:abc:frozen_hold:USD        +$50.00
```

解冻回 pending（仍未 SETTLED）或 available（已 SETTLED）。
