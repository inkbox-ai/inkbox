"""
inkbox/phone/exceptions.py

Re-exports from the canonical ``inkbox.exceptions`` module for
backward compatibility.
"""

from inkbox.exceptions import InkboxAPIError, InkboxError

__all__ = ["InkboxError", "InkboxAPIError"]
