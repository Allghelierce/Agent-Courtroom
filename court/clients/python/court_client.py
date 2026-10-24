"""Drop-in client for the court's POST /verdict. Stdlib only, so copy this file as-is.

    from court_client import convene
    verdict = convene({"charge": charge, "events": events, "testProgress": progress,
                       "spend": {"costUsd": spent, "budgetUsd": budget}, "task": task})
    verdict["ruling"], verdict.get("instruction"), verdict["caseId"]

convene() never raises: if the court is down, slow, or returns something odd, you get an
"escalate" verdict, so a worker never hangs on a dead court.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Optional

RULINGS = ("continue", "change_strategy", "escalate", "halt")


def to_jsonable(value: Any) -> Any:
    """Turn dataclasses with .to_json() (e.g. courtroom_engine.schema) into plain JSON values."""
    if hasattr(value, "to_json") and callable(value.to_json):
        return to_jsonable(value.to_json())
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    return value


def fallback_verdict(reason: str) -> dict[str, Any]:
    return {
        "ruling": "escalate",
        "reasoning": f"Court unreachable: {reason}",
        "cited_events": [],
        "caseId": None,
    }


def convene(packet: Any, url: str = "http://localhost:4100", timeout: float = 60) -> dict[str, Any]:
    """POST an EvidencePacket to {url}/verdict. Returns the Verdict dict plus "caseId"."""
    try:
        body = json.dumps(to_jsonable(packet)).encode("utf-8")
    except (TypeError, ValueError) as err:
        return fallback_verdict(f"packet is not JSON-serializable ({err})")

    req = urllib.request.Request(
        f"{url.rstrip('/')}/verdict",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            case_id: Optional[str] = resp.headers.get("X-Case-Id")
            verdict = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        return fallback_verdict(f"HTTP {err.code}: {_error_message(err)}")
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return fallback_verdict(str(getattr(err, "reason", err)))
    except ValueError as err:  # response body wasn't JSON
        return fallback_verdict(f"bad response ({err})")

    if not isinstance(verdict, dict) or verdict.get("ruling") not in RULINGS:
        return fallback_verdict(f"unexpected response {verdict!r:.200}")
    if verdict["ruling"] == "change_strategy" and not verdict.get("instruction"):
        return fallback_verdict("change_strategy verdict had no instruction")
    verdict.setdefault("cited_events", [])
    verdict["caseId"] = case_id
    return verdict


def _error_message(err: urllib.error.HTTPError) -> str:
    try:
        return str(json.loads(err.read().decode("utf-8")).get("error", err.reason))
    except Exception:
        return str(err.reason)
