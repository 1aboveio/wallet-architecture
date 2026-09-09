# 收单信息流（Acquiring Information Flow）

```mermaid
sequenceDiagram
    autonumber
    participant M as 商户<br>(Merchant)
    participant PF as 平台<br>(PF)
    participant Acq as 收单行<br>(Acquirer)
    participant CN as 卡组织<br>(Visa/MC)
    participant Iss as 发卡行<br>(Issuer)
    participant C as 买家/持卡人<br>(Cardholder)

    box rgb(230,245,255) ① AUTH 授权
    end

    C->>M: 下单支付
    M->>PF: 提交交易请求
    PF->>Acq: 转发授权请求
    Acq->>CN: 转发授权请求
    CN->>Iss: 转发授权请求

    Note over Iss: 验证卡片有效性<br>检查余额是否充足<br>冻结持卡人额度

    Iss-->>CN: 授权批准 (Auth Code)
    CN-->>Acq: 授权批准
    Acq-->>PF: 授权批准
    PF-->>M: 授权批准
    M-->>C: 支付成功

    Note over PF: 记录 Auth 元数据<br>auth_id / amount / status<br>expires_at (通常7天)

    box rgb(255,245,230) ② CAPTURE 请款
    end

    M->>M: 发货
    M->>PF: 请款请求 (Capture)
    PF->>Acq: 转发请款
    Acq->>CN: 转发请款
    CN->>Iss: 扣款指令

    Note over Iss: 从持卡人账户扣款<br>解除冻结 → 实际扣款

    Iss-->>CN: 扣款确认
    CN-->>Acq: 清算确认
    Acq-->>PF: Capture 确认
    PF-->>M: Capture 确认

    Note over PF: CAPTURE 清分:<br>pending +$100 随即拆成<br>available $94 / reserve $5 / MDR $1

    box rgb(230,255,230) ③ SETTLE 收单行 → PF
    end

    Note over CN,Acq: T+1 / T+2 批量结算

    CN->>Acq: 结算文件 (批量净额)
    Note over Acq: 扣除收单行手续费

    Acq->>PF: 到账通知 + 结算明细
    Note over PF: 银行到账 $97.50<br>逐笔对账匹配 Capture

    Note over PF: 上游 SETTLEMENT（非 Transaction.SETTLED）:<br>借 house:bank:USD +$97.50<br>借 expense:card_network_fee:USD +$1.50<br>借 expense:acquirer_fee:USD +$1.00<br>贷 receivable:txn:USD -$100

    box rgb(255,230,255) ④ SETTLE PF → 商户
    end

    Note over PF: 按结算周期批量处理<br>(如每日/每周)

    PF->>M: 结算通知
    Note over M: SETTLED：CAPTURE 已清分的净额归属商户<br>available $94（MDR $1 + 保证金 $5）

    Note over PF: 无额外扣费分录（费用已在 CAPTURE 入账）
```

## 各阶段信息要素

| 阶段 | 关键信息 | 时效 | 可逆性 |
|------|----------|------|--------|
| **Auth** | auth_id, amount, currency, card_token, expires_at | 实时 | 可撤销（超时/商户主动取消） |
| **Capture** | capture_id, auth_id, amount, shipping_info | 实时 | 可部分请款 |
| **Clearing** | 费用计算、保证金扣减、余额更新 | CAPTURE 时实时触发 | — |
| **Settle(Acq→PF)** | settlement_id, batch_id, net_amount, fee_detail, txn_list | T+1/T+2 批量 | 可调账 |
| **Settle(PF→Merchant)** | settlement_id, merchant_id, presentment_amount, MDR, net_settlement_amount, period | 按结算周期 | 可调账 |

### Clearing 流程（实时清分）

交易 CAPTURE 时立即触发：

1. **费用计算** — MDR（请款金额 × 费率）+ 按笔费（主币种标价，扣结算钱包）
2. **保证金扣减** — 滚动（入账金额 × 比率）/ 固定（主币种）
3. **净额计算** — 入账金额 − MDR − 按笔费 − 保证金
4. **余额更新** — 结算净额可见（ADR 0003 / 0004）

**注：** 实时清分 ≠ 实时结算。清分是平台内部计算，结算依赖 acquirer 的资金划转（T+1/T+2）。

详见 [ADR 0003 交易状态模型](adr/0003-transaction-status-model.md)。
