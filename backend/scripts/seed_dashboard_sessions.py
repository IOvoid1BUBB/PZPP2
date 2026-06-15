#!/usr/bin/env python3
"""Seed consolidation sessions for dashboard KPI testing (idempotent).

Creates up to 20 sessions dated today with mixed statuses and offer assignments.
Requires vehicles, driver profiles, and market offers to be seeded first.

Run from ``backend/``::

    python scripts/seed_dashboard_sessions.py [--count N]
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.services.dashboard_seed import DEFAULT_TARGET_COUNT, seed_dashboard_sessions

logger = logging.getLogger(__name__)


def _ensure_env() -> None:
    repo_root = BACKEND_ROOT.parent
    for directory in (repo_root, BACKEND_ROOT):
        env_file = directory / ".env"
        if env_file.is_file():
            os.chdir(directory)
            get_settings.cache_clear()
            return


async def _main(count: int) -> None:
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        created = await seed_dashboard_sessions(session, target_count=count)
        if created:
            print(f"Created {created} dashboard sessions.")
        else:
            print("Dashboard sessions already seeded for today.")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Seed dashboard consolidation sessions")
    parser.add_argument(
        "--count",
        type=int,
        default=DEFAULT_TARGET_COUNT,
        help=f"Target number of sessions for today (default: {DEFAULT_TARGET_COUNT})",
    )
    args = parser.parse_args()
    _ensure_env()
    asyncio.run(_main(args.count))


if __name__ == "__main__":
    main()
