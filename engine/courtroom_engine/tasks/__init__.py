from .base import Env, Script, Task, ToolOutcome
from .coding import TASK as CODING
from .prices import TASK as PRICES

TASKS: dict[str, Task] = {t.name: t for t in (CODING, PRICES)}

__all__ = ["Env", "Script", "Task", "ToolOutcome", "TASKS"]
