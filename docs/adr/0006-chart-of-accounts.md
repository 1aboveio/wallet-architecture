# 0006 科目：clearing 过渡 + 客户负债

放弃「财务 receivable / 支付 clearing 两套并行」。实现只认一套名字。

**在途用 `clearing:*`，欠商户用 `customer:*`。** 不采用 `receivable:txn` 作规范名（归档稿里出现过，视为旧名）。

理由：收款/提现/换汇已经是 `clearing:collection|payout|fx`。收单在途同样是「钱在路上」，不需要单独一套 AR 词汇。客户侧继续用 pending/available，语义是负债不是应收。

```
customer:{id}:available|pending|frozen_hold|reserve:fixed|reserve:rolling|special_account:{ccy}
house:bank:{ccy}
clearing:acquiring:{ccy}      # 收单在途（旧名 receivable:txn）
clearing:collection:{ccy}
clearing:payout:{ccy}
clearing:fx:{from}_{to}:{ccy} # 每个币种一条腿
payable:acquirer:{ccy}        # 应付通道费用
revenue:fee:{acquiring|per_item|collection|payout|fx}:{ccy}
expense:{card_network_fee|acquirer_fee|refund}:{ccy}
```

CAPTURE：借 `clearing:acquiring`，贷 `customer:pending`。  
上游到账：借 `house:bank` + `expense:*`，贷 `clearing:acquiring`（不足则贷 `payable:acquirer`）。
