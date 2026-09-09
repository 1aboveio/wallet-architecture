# 提现 / 付款分录

场景：客户 abc 提现 €400 到欧洲银行，手续费 €2。

```
── 扣钱包 ──
  借  customer:abc:available:EUR          -€402.00
  贷  clearing:payout:EUR                 +€400.00
  贷  revenue:fee:payout:EUR              +€2.00

── 银行汇出 ──
  借  clearing:payout:EUR                 -€400.00
  贷  house:bank:EUR                      -€400.00
```

结果：`available:EUR` 减少 €402；平台银行少 €400；收入 €2。
