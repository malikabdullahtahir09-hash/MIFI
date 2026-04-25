# LinkCanvas

LinkCanvas is a dependency-free affiliate marketplace website built with plain Node.js, HTML, CSS, and browser JavaScript.

## What it includes

- Public storefront for affiliate product cards
- Owner account setup with full website control
- Vendor signup and login
- Free trial access for 3 months by default
- Paid plan logic after trial at `$0.99` per month by default
- Product image uploads
- Product publish and draft states
- Owner controls for feature toggles, vendor access, subscription extensions, and website settings
- Click tracking through redirect links

## Important billing note

The subscription flow is implemented as a working demo billing action so the website logic is complete. Before launching this for real payments, replace the `/api/billing/subscribe` endpoint with Stripe, PayPal, or another payment provider.

## Run the website

```powershell
node .\server.js
```

Then open:

```text
http://localhost:3000
```

## Run the smoke test

```powershell
node .\smoke-test.js
```

The smoke test uses a temporary data folder so it does not overwrite your real website data.
