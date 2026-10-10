"""Sheetbase Studio for Python: explore pandas, Ibis and database tables.

* ``sheetbase.serve(df)`` — a local Studio in the browser.
* ``sheetbase.explore(df)`` — the Studio as a notebook widget (``pip install 'sheetbase-studio[widget]'``).
* ``sheetbase.apply_view(table, view)`` — reproduce a Studio view on any Ibis table.
"""

from .backend import StudioBackend, StudioError
from .filters import UnsupportedFilter, apply_view, compile_filter
from .server import serve

__all__ = ["StudioBackend", "StudioError", "UnsupportedFilter", "apply_view", "compile_filter", "explore", "serve", "Studio"]
__version__ = "0.6.0"


def __getattr__(name: str):
    # The widget needs anywidget; import it only when asked for.
    if name in ("explore", "Studio"):
        from . import widget

        return getattr(widget, name)
    raise AttributeError(name)
