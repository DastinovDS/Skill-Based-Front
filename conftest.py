"""Root pytest configuration shared by all workspace packages.

Hypothesis profiles are selected with the HYPOTHESIS_PROFILE environment variable:
``dev`` (default, fast local runs) or ``ci`` (reproducible: derandomized, no deadline).
"""

import os

from hypothesis import settings

settings.register_profile("dev", max_examples=50)
settings.register_profile(
    "ci",
    max_examples=200,
    derandomize=True,
    deadline=None,
    database=None,
    print_blob=True,
)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "dev"))
