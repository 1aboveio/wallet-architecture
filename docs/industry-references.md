# 业界复式记账参考（Industry References）

## Adyen

**来源：** [Design to Duty: The Accounting and Reporting Systems at Adyen](https://www.adyen.com/knowledge-hub/design-to-duty-adyen-architecture-part2)

> "For every payment that enters the system, we do double-entry bookkeeping. The way we ensure that we do so correctly is quite unique to Adyen. The only way to add new records to the accounting system is by means of templates. A template in this context is a recipe that takes certain amounts and accounts as input and converts them into specific journals that can be inserted into the ledger. These templates are mathematically verified."

> "Combine this with the aforementioned double-entry bookkeeping, and it means for every euro that ever went through Adyen, we know exactly where it came from and where it went."

**关键数据：** 一笔支付生命周期内约产生 50 条账本记录。

---

## Stripe

**来源：** [Stripe System Design: Step-by-Step Guide](https://grokkingthesystemdesign.com/guides/stripe-system-design/)

> "The Ledger and Balance Service tracks all money movement in double-entry accounting format. This ensures financial correctness across all operations where every transaction creates balanced debit and credit entries guaranteeing system-wide balances always reconcile to zero."

> "Every monetary movement in Stripe creates two entries. One is a debit from one account and the other is a credit to another. This double-entry system guarantees system-wide balances always reconcile to zero, preventing accidental money creation or deletion."

**关键数据：** 内部账本每天处理约 50 亿条事件。

**补充来源：** [Building a Payment System: Stripe's Architecture](https://dev.to/sgchris/building-a-payment-system-stripes-architecture-for-financial-transactions-3mlg)

> "Ledger: Maintains accurate financial records using double-entry bookkeeping."

---

## Square（Block）

**来源：** [Books, an Immutable Double-Entry Accounting Database](https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/)

> "We decided to invest in a scalable database technology intended specifically for tracking financial transactions. We wanted to provide infrastructure which ensures that every dollar, euro, or pound we move is accounted for."

> "Double Entry Accounting forces you to state not just what financial state change occurred, but *why*. The accounting equation states that all transactions must balance to 0, so each cent lost is matched with a cent gained."

---

## Wise

**来源：** [Building a Real-Time Ledger System](https://www.martinrichards.me/post/ledger_p2_scaling_double_entry_ledger_massive_psp/)

> "Stripe's internal ledger sees 'five billion events' daily—roughly 50-100 events per payment given their volume. Adyen's architecture blog states that 'over the lifetime of a payment transaction, about 50 rows have to be inserted into the accounting database.'"

---

## 业界通用实践

**来源：** [Payment Ledger Architecture: How Modern Fintechs Design](https://trio.dev/payment-ledger-architecture-fintech/)

> "Double-entry bookkeeping has been the standard for many years, since it enforces a mathematical invariant. Every transaction that credits one account must debit another by the same amount. The sum of all debits equals the sum of all credits."

**来源：** [Why Your Fintech Needs a Double-Entry Ledger](https://medium.com/@payflux/why-your-fintech-needs-a-double-entry-ledger-48314a0e8527)

> "At its core, every fintech product needs to answer one fundamental question: Where did the money go — and why? A ledger is not just a transactions table. It's a durable, auditable system of record that explains the movement of money with mathematical certainty."

**来源：** [Why Fintech Systems Must Use a Double-Entry Ledger](https://geekersjoel237.substack.com/p/why-fintech-systems-must-use-a-double)

> "A balance is not a fact. It is a conclusion. The balance on a wallet account is the result of every operation that has ever touched that account."

---

## 每笔支付的账本记录数

| 公司 | 每笔支付的账本记录数 | 来源 |
|------|---------------------|------|
| 传统收单 | 10-20 条 | Martin Richards |
| Adyen | ~50 条 | Adyen Architecture Blog |
| Stripe | ~50-100 条 | Martin Richards |
| Square | 取决于业务复杂度 | Square Engineering Blog |
