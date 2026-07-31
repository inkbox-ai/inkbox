"""
Configuration for daily briefing agent
"""

import os
from typing import Optional


class Config:
    """Configuration settings for the briefing agent"""
    
    # Inkbox settings
    INKBOX_API_KEY: str = os.environ.get("INKBOX_API_KEY", "")
    
    # Briefing settings
    BRIEFING_TIME: str = os.environ.get("BRIEFING_TIME", "08:00")
    MAX_DURATION_SECONDS: int = int(os.environ.get("MAX_DURATION_SECONDS", "120"))
    
    # User settings
    USER_PHONE_NUMBER: str = os.environ.get("YOUR_PHONE_NUMBER", "")
    
    # Agent settings
    AGENT_HANDLE: str = os.environ.get("AGENT_HANDLE", "daily-briefing")
    AGENT_DISPLAY_NAME: str = os.environ.get("AGENT_DISPLAY_NAME", "Daily Briefing Agent")
    
    # Content settings
    DEFAULT_TOPICS: list[str] = ["calendar", "news", "weather", "priorities"]
    MAX_CALENDAR_EVENTS: int = 3
    MAX_NEWS_ITEMS: int = 2
    MAX_PRIORITIES: int = 3
    
    # Voice settings
    VOICE_MODEL: str = os.environ.get("VOICE_MODEL", "default")
    
    @classmethod
    def validate(cls) -> list[str]:
        """Validate configuration and return list of errors"""
        errors = []
        
        if not cls.INKBOX_API_KEY:
            errors.append("INKBOX_API_KEY is required")
        
        if not cls.USER_PHONE_NUMBER:
            errors.append("YOUR_PHONE_NUMBER is required")
        
        # Validate time format
        try:
            from datetime import datetime
            datetime.strptime(cls.BRIEFING_TIME, "%H:%M")
        except ValueError:
            errors.append(f"BRIEFING_TIME must be in HH:MM format, got: {cls.BRIEFING_TIME}")
        
        # Validate duration
        if not (30 <= cls.MAX_DURATION_SECONDS <= 120):
            errors.append("MAX_DURATION_SECONDS must be between 30 and 120")
        
        return errors
