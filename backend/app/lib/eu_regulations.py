"""Driver-hours limits from Regulation (EC) No 561/2006.

Central source of truth for the numeric thresholds used across the driver
compliance evaluation, the route-map rest-point projection, and the CP-SAT
solver. Keeping them here avoids drift between modules and documents the
relevant article for each value.

References (EU 561/2006):
- Art. 6(1): max daily driving time (9h, extendable to 10h twice a week).
- Art. 6(2): max weekly driving time (56h).
- Art. 6(3): max driving over two consecutive weeks (90h).
- Art. 7: 45 min break after 4.5h of accumulated driving.
- Art. 8: regular daily rest of at least 11h, reducible to 9h max 3x/week.
"""

from __future__ import annotations

# Art. 6(1) — daily driving limits.
MAX_DAILY_DRIVING_H: float = 9.0
MAX_EXTENDED_DAILY_H: float = 10.0
MAX_EXTENDED_DAYS_PER_WEEK: int = 2

# Art. 6(2) / 6(3) — weekly and bi-weekly driving limits.
MAX_WEEKLY_DRIVING_H: float = 56.0
# Conservative planning budget kept below the hard 56h ceiling to leave slack.
MAX_WEEKLY_DRIVING_H_SAFE: float = 54.5
MAX_BIWEEKLY_DRIVING_H: float = 90.0

# Art. 7 — mandatory break after continuous driving.
MIN_BREAK_AFTER_H: float = 4.5
MIN_BREAK_MIN: int = 45

# Art. 8 — daily rest periods (minutes).
MIN_DAILY_REST_MIN: int = 660
MIN_REDUCED_REST_MIN: int = 540
MAX_REDUCED_REST_PER_WEEK: int = 3
