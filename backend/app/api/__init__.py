"""API routers (HTTP layer).

Each module exposes a :class:`fastapi.APIRouter` registered in
:func:`app.api.router.build_api_router`.
"""

from app.api.router import build_api_router

__all__ = ["build_api_router"]
