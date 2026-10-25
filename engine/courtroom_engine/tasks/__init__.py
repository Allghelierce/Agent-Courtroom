from .base import Env, Script, Task, ToolOutcome
from .coding import TASK as CODING
from .prices import TASK as PRICES
from .checkout_verified import TASK as CHECKOUT_VERIFIED

TASKS: dict[str, Task] = {t.name: t for t in (CODING, PRICES, CHECKOUT_VERIFIED)}

__all__ = ["Env", "Script", "Task", "ToolOutcome", "TASKS"]
