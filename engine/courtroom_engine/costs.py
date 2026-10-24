"""Usage estimates from the same versioned price table used by the court."""

from __future__ import annotations

import json
import re
from pathlib import Path

PRICES = json.loads((Path(__file__).resolve().parents[2] / "shared/model-prices.json").read_text())


def _key(model: str) -> str:
    return model if model in PRICES["models"] else re.sub(r"-\d{8}$", "", model)


def model_provider(model: str) -> str | None:
    """The brain ("claude" or "groq") that serves this model, or None if it isn't in the table."""
    return PRICES["modelProviders"].get(_key(model))


def pricing_info(model: str) -> dict:
    """Where this model's rates came from and when they were checked."""
    provider = PRICES["providers"].get(model_provider(model), {})
    return {"source": provider.get("source"), "verifiedAt": provider.get("verifiedAt")}


def model_rates(model: str, input_tokens: int = 0):
    key = _key(model)
    rates = PRICES["models"].get(key)
    if key == "claude-haiku-5-5" and input_tokens > PRICES["haikuLongContextThreshold"]:
        rates = PRICES["haikuLongContextRates"]
    return rates


def price_usage(model: str, usage: dict) -> float | None:
    inputs = usage.get("input_tokens", 0)
    outputs = usage.get("output_tokens", 0)
    writes = usage.get("cache_creation_input_tokens") or 0
    reads = usage.get("cache_read_input_tokens") or 0
    cache = usage.get("cache_creation") or {}
    one_hour = cache.get("ephemeral_1h_input_tokens") or 0
    rates = model_rates(model, inputs + writes + reads)
    if rates is None:
        return None
    return (inputs * rates[0] + outputs * rates[1] + (writes - one_hour) * rates[2] + one_hour * rates[3] + reads * rates[4]) / 1_000_000
