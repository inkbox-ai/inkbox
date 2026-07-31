"""
SMS Handler - Processes SMS commands to update briefing preferences
"""

import logging
import re
from typing import Optional

from src.config import Config

logger = logging.getLogger(__name__)


class SMSHandler:
    """Handles incoming SMS commands for preference updates"""
    
    def __init__(self, user_phone: str):
        self.user_phone = user_phone
        self.command_patterns = {
            r"add\s+topic\s+(.+)$": self._add_topic,
            r"remove\s+topic\s+(.+)$": self._remove_topic,
            r"set\s+time\s+(\d{1,2}:\d{2})$": self._set_time,
            r"skip\s+today$": self._skip_today,
            r"duration\s+(\d+)$": self._set_duration,
            r"enable$": self._enable,
            r"disable$": self._disable,
            r"help$": self._help,
            r"topics$": self._list_topics,
        }
    
    def process_command(
        self,
        from_number: str,
        text: str,
        preferences: dict,
    ) -> tuple[bool, str]:
        """Process an SMS command and return (success, response_message)"""
        if from_number != self.user_phone:
            logger.warning(f"Ignoring SMS from unknown number: {from_number}")
            return False, "Unauthorized sender"
        
        text_lower = text.lower().strip()
        logger.info(f"Processing command from {from_number}: {text_lower}")
        
        for pattern, handler in self.command_patterns.items():
            match = re.match(pattern, text_lower)
            if match:
                try:
                    return handler(match, preferences)
                except Exception as e:
                    logger.error(f"Error processing command: {e}")
                    return False, f"Error: {str(e)}"
        
        return False, "Unknown command. Text 'help' for available commands."
    
    def _add_topic(self, match, preferences: dict) -> tuple[bool, str]:
        """Add a topic to briefing preferences"""
        topic = match.group(1).strip()
        topics = preferences.get("topics", Config.DEFAULT_TOPICS.copy())
        
        if topic in topics:
            return False, f"Topic '{topic}' already in your briefing"
        
        topics.append(topic)
        preferences["topics"] = topics
        return True, f"Added topic '{topic}' to your briefing"
    
    def _remove_topic(self, match, preferences: dict) -> tuple[bool, str]:
        """Remove a topic from briefing preferences"""
        topic = match.group(1).strip()
        topics = preferences.get("topics", Config.DEFAULT_TOPICS.copy())
        
        if topic not in topics:
            return False, f"Topic '{topic}' not in your briefing"
        
        topics.remove(topic)
        preferences["topics"] = topics
        return True, f"Removed topic '{topic}' from your briefing"
    
    def _set_time(self, match, preferences: dict) -> tuple[bool, str]:
        """Set briefing time"""
        time_str = match.group(1)
        try:
            from datetime import datetime
            datetime.strptime(time_str, "%H:%M")
            preferences["briefing_time"] = time_str
            return True, f"Briefing time set to {time_str}"
        except ValueError:
            return False, f"Invalid time format. Use HH:MM (e.g., 08:00)"
    
    def _skip_today(self, match, preferences: dict) -> tuple[bool, str]:
        """Skip today's briefing"""
        preferences["enabled"] = False
        preferences["skip_today"] = True
        return True, "Skipping today's briefing. Will resume tomorrow."
    
    def _set_duration(self, match, preferences: dict) -> tuple[bool, str]:
        """Set max briefing duration"""
        try:
            duration = int(match.group(1))
            if 30 <= duration <= 120:
                preferences["max_duration_seconds"] = duration
                return True, f"Max duration set to {duration} seconds"
            else:
                return False, "Duration must be between 30 and 120 seconds"
        except ValueError:
            return False, "Invalid duration. Use a number between 30 and 120"
    
    def _enable(self, match, preferences: dict) -> tuple[bool, str]:
        """Enable briefings"""
        preferences["enabled"] = True
        return True, "Briefings enabled"
    
    def _disable(self, match, preferences: dict) -> tuple[bool, str]:
        """Disable briefings"""
        preferences["enabled"] = False
        return True, "Briefings disabled"
    
    def _help(self, match, preferences: dict) -> tuple[bool, str]:
        """Show help message"""
        help_text = """Available commands:
- add topic [name]: Add a topic (e.g., 'add topic tech')
- remove topic [name]: Remove a topic (e.g., 'remove topic sports')
- set time [HH:MM]: Set briefing time (e.g., 'set time 09:00')
- skip today: Skip today's briefing
- duration [seconds]: Set max duration (30-120s)
- enable: Enable briefings
- disable: Disable briefings
- topics: List current topics
- help: Show this message"""
        return True, help_text
    
    def _list_topics(self, match, preferences: dict) -> tuple[bool, str]:
        """List current topics"""
        topics = preferences.get("topics", Config.DEFAULT_TOPICS)
        return True, f"Current topics: {', '.join(topics)}"
