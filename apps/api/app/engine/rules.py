"""Safe expression evaluation for rule-mode routers, e.g. `decision == 'yes' and len(draft) < 280`."""

from simpleeval import EvalWithCompoundTypes, InvalidExpression


def evaluate(expression: str, vars: dict) -> bool:
    ev = EvalWithCompoundTypes(names=dict(vars))
    ev.functions.update({"len": len, "str": str, "int": int, "float": float, "lower": str.lower})
    try:
        return bool(ev.eval(expression))
    except (InvalidExpression, NameError, TypeError, ValueError, SyntaxError, KeyError):
        return False
