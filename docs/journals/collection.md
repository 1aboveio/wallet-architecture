# 收款分录

规则见 [ADR 0005](../adr/0005-ledger-invariants.md)。

场景：Amazon 给客户 abc 打款 $1,000 USD，收款手续费 0.5%。

```
── 银行到账 ──
  借  house:bank:USD                      +$1,000.00
  贷  clearing:collection:USD             +$1,000.00

── 入钱包 ──
  借  clearing:collection:USD             -$1,000.00
  贷  customer:abc:available:USD          +$1,000.00

── 手续费 ──
  借  customer:abc:available:USD          -$5.00
  贷  revenue:fee:collection:USD          +$5.00
```

结果：`available:USD` = $995.00。
