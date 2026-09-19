# Changelog

## 0.1.2

- README: script-tag links use `@0.1` (newest 0.1.x) instead of a fixed version.

## 0.1.1

- Published from its own repository: github.com/CreptapayHq/creptapay-checkout.
- Adds the LICENSE file to the published package.
- No code changes from 0.1.0.

## 0.1.0

- First release.
- `initialize()` creates a payment with your public key.
- Three ways to show the checkout: `open()` (popup), `mount()` (inline iframe), `redirect()` (hosted page).
- `checkout()` creates the payment and shows it in one call.
- Callbacks: `onSuccess`, `onStatusChange`, `onExpired`, `onClose`, `onLoad`, `onError`.
- Only trusts messages from the CreptaPay checkout iframe it created.
- ESM, CommonJS, TypeScript types and a `<script>` build (`window.CreptaPay`).
