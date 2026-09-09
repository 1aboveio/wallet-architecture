# 0007 报价契约与报表汇率

报价服务只算**下游商户价**（MDR、按笔费、保证金、净额）。不上 IC/scheme。汇率规则见 0004。

## Quote 入参

```
merchant_id: string
presentment_amount: decimal
presentment_currency: ISO-4217
primary_currency: ISO-4217
enabled_settlement_currencies: ISO-4217[]
mode: indicative | capture
# capture：用当前可成交入账汇率，结果须写入交易
# indicative：报价预览，不入账
as_of: RFC3339?          # 缺省=现在；仅 indicative 可指定历史
```

费率从商户合约读取，不由调用方传入（防绕过）。

## Quote 出参

```
settlement_currency
booking_fx_rate            # presentment → settlement
booking_amount
mdr_amount                 # 结算币种
per_item_fee_quoted        # 主币种标价
per_item_fee_amount        # 折结算币种、从 pending 扣
rolling_reserve_amount     # 结算币种
fixed_reserve_amount       # 主币种（从结算腿扣等值）
net_settlement_amount      # 留在 pending 的净额
rates: { booking_fx_rate, as_of, source }
costs[]?                   # 可选，indicative 上游费用，不进净额
```

`settlement_currency` = presentment ∈ enabled ? presentment : primary。

CAPTURE 必须先 Quote(mode=capture) 再入账，分录金额以该次出参为准。

## 报表

各币种科目**按报表日 UTC 日终牌价**折主币种（`report_fx_rate`）。不回溯 `booking_fx_rate`。与入账汇率之差记翻译损益，接受波动。

月度保底/封顶：先按各币种 MDR 记账，再按报表日折主币种加总后与保底/封顶比较，差额用主币种补扣或退。
