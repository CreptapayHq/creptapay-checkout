# @creptapay/checkout

Accept USDC, EURC and USDT with [CreptaPay](https://creptapay.online). Create a payment, then either send the customer to the hosted checkout or show it on your own page. You get a callback, or a redirect back to your site, when it's paid.

```bash
npm install @creptapay/checkout
```

Or use a `<script>` tag:

```html
<script src="https://unpkg.com/@creptapay/checkout@0.1.0/dist/creptapay.js"></script>
```

## Quick start

```js
import CreptaPay from "@creptapay/checkout";

const crepta = new CreptaPay({ publicKey: "pk_test_..." }); // from your CreptaPay dashboard

const payment = await crepta.initialize({
  amount: 25,
  currency: "USD",
  description: "Order #1042",
  customer: { email: "ada@example.com", first_name: "Ada", last_name: "Lovelace" },
  metadata: { order_id: "1042" },
  redirectUrl: "https://shop.example.com/checkout/complete", // used by redirect mode
});
```

Then pick how to show the checkout:

### 1. Popup (modal over your page)

```js
crepta.open(payment, {
  onSuccess: (result) => {
    // result.reference, result.status ("paid" | "overpaid"), result.txHash
    fetch(`/api/orders/verify?reference=${result.reference}`); // verify on your server
  },
  onClose: () => console.log("checkout closed"),
});
```

### 2. Inline (inside an element on your page)

```html
<div id="pay"></div>
```

```js
crepta.mount("#pay", payment, { onSuccess: (r) => showThankYou(r.reference) });
```

### 3. Redirect (hosted page)

```js
crepta.redirect(payment);
```

After payment, the customer is sent to your `redirectUrl` with the result:

```
https://shop.example.com/checkout/complete?reference=ab12cd34&status=paid
```

### One call

```js
await crepta.checkout({
  amount: 25,
  customer: { email: "ada@example.com", first_name: "Ada", last_name: "Lovelace" },
  mode: "popup", // "popup" | "inline" | "redirect"
  // container: "#pay",  // for inline
  onSuccess: (r) => console.log("paid", r.reference),
});
```

## Callbacks

| Callback | When |
|---|---|
| `onLoad()` | The checkout has loaded |
| `onStatusChange(result)` | Any status change: `pending`, `confirming`, `underpaid`, `expired`, `paid` |
| `onSuccess(result)` | The payment is fully received (`paid` or `overpaid`). Fires once. |
| `onExpired(result)` | The payment window ended before full payment |
| `onClose({ reference, status })` | The customer closed the checkout |
| `onError(error)` | The checkout failed to load |

If you don't pass `onSuccess` and the payment has a `redirectUrl`, the popup and inline modes also redirect after success. You can control this with `redirectOnSuccess`. The popup closes itself 2.5s after success (`autoCloseAfterSuccess`).

## Always verify on your server

Browser callbacks and redirects can be faked. Only fulfil orders after your server confirms payment, in one of two ways:

- **Webhook (recommended):** listen for `payment.paid` in your webhook endpoint. `metadata` is included.
- **API:** check the payment with your **secret** key from your server:

```js
// Node, on your server. Never ship sk_ keys to the browser.
const res = await fetch(`https://api.creptapay.online/v1/payment/${paymentId}`, {
  headers: { "x-api-key": process.env.CREPTAPAY_SECRET_KEY },
});
const { data } = await res.json();
if (data.status === "paid" || data.status === "overpaid") fulfil(data.metadata.order_id);
```

## API

`new CreptaPay({ publicKey, apiUrl?, checkoutUrl? })`: `pk_test_…` keys create sandbox payments, `pk_live_…` keys create real ones.

| Method | Returns |
|---|---|
| `initialize(params)` | `Promise<Payment>`: `{ id, reference, checkoutUrl, status, total, currency, redirectUrl, metadata, raw }` |
| `open(payment, options)` | `{ reference, close() }` |
| `mount(container, payment, options)` | `{ reference, close() }` |
| `redirect(payment)` | void |
| `checkout(params & options & { mode, container })` | handle or void |
| `getPayment(reference)` | `Promise<Payment>` (current status; for UI, not fulfilment) |

`payment` can be the object returned by `initialize()`, a checkout URL, or a reference (a reference needs `checkoutUrl` set in the constructor).

`initialize` params: `amount` or `items`, `currency` (`USD` or `EUR`), `description`, `customer { email, first_name, last_name, phone? }` or `customerId`, `redirectUrl` (https), `metadata` (at most 4 KB), `cryptoCurrency`, `network`, `expiresAt`.

Errors are `CreptaPayError` with `.message` and `.status`.

## Script tag

```html
<script src="https://unpkg.com/@creptapay/checkout@0.1.0/dist/creptapay.js"></script>
<script>
  const crepta = new CreptaPay({ publicKey: "pk_test_..." });
  document.querySelector("#buy").onclick = () =>
    crepta.checkout({
      amount: 10,
      customer: { email: "a@b.com", first_name: "A", last_name: "B" },
      onSuccess: (r) => alert("Paid! " + r.reference),
    });
</script>
```

## Development

```bash
git clone git@github.com:CreptapayHq/creptapay-checkout.git
cd creptapay-checkout
npm install
npm run build     # dist/: esm, cjs, types, creptapay.js
npm test
```

Try it in a browser: open `examples/index.html` and enter your `pk_test_` key.

### Releasing

1. Update `CHANGELOG.md`.
2. Run `npm version patch` (or `minor` or `major`). This updates `package.json` and creates a `vX.Y.Z` tag.
3. Run `git push --follow-tags`. The **Publish to npm** workflow builds, tests and publishes.

The workflow needs an `NPM_TOKEN` repository secret: a granular access token with read and write access to `@creptapay` and **Bypass 2FA** enabled.

To publish by hand instead, run `npm publish --otp=<code>`.

## License

MIT. See [LICENSE](LICENSE).
