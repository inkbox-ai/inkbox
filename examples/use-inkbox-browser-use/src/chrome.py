"""
browser-use/src/chrome.py

Utilities for checking and launching Chrome in debug mode.
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
import time

import requests

logger = logging.getLogger(__name__)

DEFAULT_PORT = 9222


def check_chrome_running(port: int = DEFAULT_PORT) -> bool:
    """Check if Chrome is already running in debug mode on the given port."""
    try:
        response = requests.get(f"http://127.0.0.1:{port}/json/version", timeout=2)
        return response.status_code == 200
    except (requests.RequestException, requests.Timeout):
        return False


def find_chrome_path() -> str | None:
    """Find Chrome executable path based on OS."""
    system = platform.system()

    if system == "Darwin":
        chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        if os.path.isfile(chrome_path):
            return chrome_path
    elif system == "Linux":
        for name in ["google-chrome", "chromium-browser", "chromium", "chrome"]:
            chrome_path = shutil.which(name)
            if chrome_path:
                return chrome_path
    elif system == "Windows":
        possible_paths = [
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        ]
        for path in possible_paths:
            if os.path.isfile(path):
                return path
        chrome_path = shutil.which("chrome") or shutil.which("google-chrome")
        if chrome_path:
            return chrome_path

    return None


def launch_chrome(port: int = DEFAULT_PORT) -> subprocess.Popen | None:
    """
    Launch Chrome in debug mode.

    Returns the Popen process if launched successfully, None otherwise.
    """
    chrome_path = find_chrome_path()

    if not chrome_path:
        logger.warning("Chrome not found automatically.")
        return None

    if platform.system() == "Windows":
        chrome_user_dir = os.path.expandvars(r"%USERPROFILE%\tmp\chrome")
    else:
        chrome_user_dir = os.path.expanduser("~/tmp/chrome")

    os.makedirs(chrome_user_dir, exist_ok=True)

    chrome_args = [
        chrome_path,
        "--remote-debugging-address=127.0.0.1",
        f"--remote-debugging-port={port}",
        f"--user-data-dir={chrome_user_dir}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
    ]

    logger.info("Launching Chrome on port %d...", port)
    try:
        creation_flags = 0
        if platform.system() == "Windows":
            creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP

        process = subprocess.Popen(
            chrome_args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )

        for _ in range(10):
            if check_chrome_running(port):
                logger.info("Chrome is ready on port %d", port)
                time.sleep(0.5)
                return process
            time.sleep(1)

        logger.warning("Chrome failed to start within timeout.")
        try:
            process.terminate()
            process.kill()
        except Exception:
            pass

        return None

    except Exception as e:
        logger.error("Error launching Chrome: %s", e)
        return None


def ensure_chrome_running(url: str) -> subprocess.Popen | None:
    """
    Ensure Chrome is running in debug mode at the given URL.
    Attempts to launch it automatically if not running.
    Raises RuntimeError with instructions if it cannot be started.

    Args:
        url: Chrome remote debugging URL (e.g. "http://127.0.0.1:9222").

    Returns:
        The Chrome Popen process if we launched it, None if it was already running.
    """
    # extract port from URL
    try:
        port = int(url.rsplit(":", 1)[-1].strip("/"))
    except (ValueError, IndexError):
        port = DEFAULT_PORT

    if check_chrome_running(port):
        logger.info("Chrome is running on port %d", port)
        return None

    logger.info("Chrome not detected on port %d, attempting to launch...", port)
    process = launch_chrome(port)

    if process and check_chrome_running(port):
        logger.info("Chrome launched successfully")
        return process

    system = platform.system()
    if system == "Darwin":
        cmd = (
            '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\\n'
            f"  --remote-debugging-address=127.0.0.1 \\\n"
            f"  --remote-debugging-port={port} \\\n"
            '  --user-data-dir="$HOME/tmp/chrome" \\\n'
            "  --remote-allow-origins='*' \\\n"
            "  --no-first-run \\\n"
            "  --no-default-browser-check"
        )
    elif system == "Windows":
        cmd = (
            "chrome.exe `\n"
            f"  --remote-debugging-address=127.0.0.1 `\n"
            f"  --remote-debugging-port={port} `\n"
            '  --user-data-dir="$env:USERPROFILE\\tmp\\chrome" `\n'
            "  --remote-allow-origins=* `\n"
            "  --no-first-run `\n"
            "  --no-default-browser-check"
        )
    else:
        cmd = (
            "google-chrome \\\n"
            f"  --remote-debugging-address=127.0.0.1 \\\n"
            f"  --remote-debugging-port={port} \\\n"
            '  --user-data-dir="$HOME/tmp/chrome" \\\n'
            "  --remote-allow-origins='*' \\\n"
            "  --no-first-run \\\n"
            "  --no-default-browser-check"
        )

    raise RuntimeError(
        f"Chrome is not running in debug mode on port {port}.\n\n"
        f"Launch Chrome manually:\n\n{cmd}\n\n"
        f"Then verify with:\n  curl http://127.0.0.1:{port}/json/version\n\n"
        f"Or use --env cloud to skip local Chrome."
    )
