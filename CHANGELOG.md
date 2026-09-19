# Changelog

## 0.1.0

- First release.
- `initialize()` creates a payment with your public key.
- Three ways to show the checkout: `open()` (popup), `mount()` (inline iframe), `redirect()` (hosted page).
- `checkout()` creates the payment and shows it in one call.
- Callbacks: `onSuccess`, `onStatusChange`, `onExpired`, `onClose`, `onLoad`, `onError`.
- Only trusts messages from the CreptaPay checkout iframe it created.
- ESM, CommonJS, TypeScript types and a `<script>` build (`window.CreptaPay`).
