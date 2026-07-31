"""
Duration Controller - Ensures briefings stay within 2-minute limit
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class DurationController:
    """Controls briefing duration to ensure it stays within limits"""
    
    def __init__(self, max_duration_seconds: int = 120):
        self.max_duration_seconds = max_duration_seconds
        self.word_rate = 150  # Average speaking rate: 150 words per minute
        self.max_words = (max_duration_seconds / 60) * self.word_rate
    
    def estimate_duration(self, text: str) -> float:
        """Estimate speaking duration in seconds for given text"""
        word_count = len(text.split())
        estimated_minutes = word_count / self.word_rate
        return estimated_minutes * 60
    
    def truncate_to_fit(self, text: str, sections: dict[str, str]) -> dict[str, str]:
        """Truncate sections to fit within max duration"""
        current_text = "\n".join(sections.values())
        current_duration = self.estimate_duration(current_text)
        
        if current_duration <= self.max_duration_seconds:
            return sections
        
        # Calculate how much to reduce
        excess_duration = current_duration - self.max_duration_seconds
        excess_words = int((excess_duration / 60) * self.word_rate)
        
        logger.warning(
            f"Briefing exceeds limit by {excess_duration:.1f}s "
            f"({excess_words} words), truncating"
        )
        
        # Prioritize sections: greeting > priorities > calendar > news > weather
        priority_order = ["greeting", "priorities", "calendar", "news", "weather"]
        
        truncated = {}
        remaining_words = self.max_words
        
        for section in priority_order:
            if section not in sections:
                continue
            
            section_text = sections[section]
            section_words = len(section_text.split())
            
            if section_words <= remaining_words:
                truncated[section] = section_text
                remaining_words -= section_words
            else:
                # Truncate this section to fit remaining words
                words = section_text.split()[:remaining_words]
                truncated[section] = " ".join(words)
                remaining_words = 0
                break
        
        # Add any remaining low-priority sections if space allows
        for section in sections:
            if section not in truncated and remaining_words > 0:
                section_text = sections[section]
                section_words = len(section_text.split())
                
                if section_words <= remaining_words:
                    truncated[section] = section_text
                    remaining_words -= section_words
        
        return truncated
    
    def validate_script(self, script: str) -> tuple[bool, float]:
        """Validate that a script fits within duration limit"""
        duration = self.estimate_duration(script)
        is_valid = duration <= self.max_duration_seconds
        
        if not is_valid:
            logger.warning(
                f"Script duration {duration:.1f}s exceeds limit {self.max_duration_seconds}s"
            )
        
        return is_valid, duration
