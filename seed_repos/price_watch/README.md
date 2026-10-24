# price_watch

Seed data for the price-collector worker. The worker can't read these files directly; it only sees them through its `fetch_page` tool.

- `products.json`: what the worker is asked to price.
- `sites/<host>/<path>.html`: the mock store pages, served at `https://<host>/<path>`.
- `site_status.json`: hosts that answer every request with an HTTP error. `shop-c.example` is the trap: it always returns 503.
- `answers.json`: the answer key used to score progress. A product counts as resolved when its saved price matches, or when it is flagged and its store really is down.
