#!/usr/bin/env python3
"""Run the read-only qualifier with deterministic JSON request headers."""
from pathlib import Path
import runpy
from urllib.request import build_opener, install_opener

opener = build_opener()
opener.addheaders = [
    ("User-Agent", "curl/8.5.0"),
    ("Accept", "application/json"),
]
install_opener(opener)
runpy.run_path(str(Path(__file__).with_name("run.py")), run_name="__main__")
