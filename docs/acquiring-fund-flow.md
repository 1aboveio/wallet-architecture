# 收单资金流（Acquiring Fund Flow）

```mermaid
sequenceDiagram
    autonumber
    participant C as 买家/持卡人<br>(Cardholder)
    participant Iss as 发卡行<br>(Issuer)
    participant CN as 卡组织<br>(Visa/MC)
    participant Acq as 收单行<br>(Acquirer)
    participant PF as 平台<br>(PF)
    participant M as 商户<br>(Merchant)

    box rgb(230,245,255) ① AUTH 授权 — 无资金流动
    end

    C->>C: 冻结 $100 额度
    Note over C,Iss: ✗ 无实际资金流动<br>仅冻结持卡人信用额度

    box rgb(255,245,230) ② CAPTURE 请款 — 资金开始流转
    end

    Note over C: 解除冻结 → 实际扣款

    C-)Iss: -$100.00
    Note over C,Iss: 持卡人 → 发卡行

    Iss-)CN: +$100.00
    Note over Iss,CN: 发卡行 → 卡组织<br>(暂存, 等待批量清算)

    Note over CN: $100 暂存卡组织<br>等待 T+1/T+2 清算

    box rgb(230,255,230) ③ SETTLE 收单行→PF — 逐级扣费
    end

    Note over CN,Acq: T+1 / T+2 净额结算

    CN->>Acq: -$1.50 (网络费)
    CN-)Acq: +$98.50
    Note over CN,Acq: 卡组织 → 收单行<br>$100 - $1.50 = $98.50

    Acq->>PF: -$1.00 (收单行费用)
    Acq-)PF: +$97.50
    Note over Acq,PF: 收单行 → PF 银行<br>$98.50 - $1.00 = $97.50

    Note over PF: PF 银行到账 $97.50

    box rgb(255,230,255) ④ SETTLE PF→商户 — 扣除平台费用
    end

    PF->>M: -$1.00 (PF 服务费)
    PF-)M: +$99.00
    Note over PF,M: PF 银行 → 商户钱包<br>$100 - $1.00 = $99.00

    Note over M: 商户可用余额 +$99.00<br>可提现 / 换汇 / 付款
```

## 各环节资金明细

```
买家支付:                               $100.00
                                      ────────
卡组织网络费 (Visa/MC):                  -$1.50
收单行手续费 (Acquirer):                 -$1.00
PF 服务费:                                -$1.00
                                      ────────
商户实收:                                $96.50

总费率: 3.5%
```

## 资金在各节点的停留时间

```
买家刷卡 ──→ 发卡行扣款 ──→ 卡组织暂存 ──→ 收单行 ──→ PF银行 ──→ 商户钱包
   │             │              │             │            │              │
   │         实时(秒级)      T+1~T+2       T+1~T+2      T+0~T+1        按周期
   │                          批量清算       到账通知     银行入账       (日/周)
   │
 Auth                               Capture ──────────────── Settle ────── Settle
 (实时)                              (实时)                  (Acq→PF)     (PF→Merchant)
```

## 关键风险点

| 风险 | 发生阶段 | 影响 | 应对 |
|------|----------|------|------|
| **Auth 过期** | ①→② 之间 | 授权超时未请款，交易失效 | 设置请款时限提醒 |
| **部分请款** | ② | 金额与 Auth 不一致 | 支持部分 Capture，记录差异 |
| **退单 (Chargeback)** | ④ 之后 | 资金从商户扣回 | 备付金/Reserve 机制 |
| **批量结算差异** | ③ | 银行到账总额与逐笔 Capture 不匹配 | 自动对账 + 异常标记 |
| **跨日结算** | ③ | Capture 和 Settle 跨日，汇率波动 | 记账以 Capture 日汇率为准 |
```
