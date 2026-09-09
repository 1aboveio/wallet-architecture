# 换汇分录

跨币种必须分腿，每腿自平衡（ADR 0005）。

场景：客户 abc 把 $500 USD 换成 EUR。银行价 1 USD = 0.92 EUR，平台价差 0.3%。

银行换得 €460.00；价差 €1.38；客户实得 €458.62。

```
── USD 腿 ──
  借  customer:abc:available:USD          -$500.00
  贷  clearing:fx:USD_EUR:USD             +$500.00

  借  clearing:fx:USD_EUR:USD             -$500.00
  贷  house:bank:USD                      -$500.00

── EUR 腿 ──
  借  house:bank:EUR                      +€460.00
  贷  clearing:fx:USD_EUR:EUR             +€460.00

  借  clearing:fx:USD_EUR:EUR             -€460.00
  贷  customer:abc:available:EUR          +€458.62
  贷  revenue:fee:fx:EUR                  +€1.38
```
