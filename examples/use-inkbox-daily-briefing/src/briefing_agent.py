"""
Daily Briefing Agent - AI voice agent with 2-minute morning briefings
"""

import asyncio
import logging
import os
from datetime import datetime, time
from typing import Optional

import schedule
from pydantic import BaseModel, Field

from inkbox import Inkbox

logger = logging.getLogger(__name__)


class BriefingPreferences(BaseModel):
    """User preferences for daily briefings"""
    
    briefing_time: str = Field(default="08:00", description="Time for daily briefing (HH:MM)")
    max_duration_seconds: int = Field(default=120, description="Max briefing duration in seconds")
    topics: list[str] = Field(
        default_factory=lambda: ["calendar", "news", "weather", "priorities"],
        description="Topics to include in briefing"
    )
    phone_number: str = Field(..., description="User's phone number")
    enabled: bool = Field(default=True, description="Whether briefings are enabled")


class BriefingContent(BaseModel):
    """Content for a single briefing"""
    
    greeting: str
    calendar_events: list[str]
    news_items: list[str]
    weather: str
    priorities: list[str]
    closing: str


class BriefingAgent:
    """Main briefing agent that orchestrates daily briefings"""
    
    def __init__(
        self,
        api_key: str,
        user_phone: str,
        briefing_time: str = "08:00",
        agent_handle: str = "daily-briefing",
    ):
        self.api_key = api_key
        self.user_phone = user_phone
        self.agent_handle = agent_handle
        self.preferences = BriefingPreferences(
            phone_number=user_phone,
            briefing_time=briefing_time,
        )
        self.inkbox: Optional[Inkbox] = None
        self.identity = None
        
    async def initialize(self):
        """Initialize Inkbox client and create/get identity"""
        self.inkbox = Inkbox(api_key=self.api_key)
        
        # Try to get existing identity or create new one
        try:
            self.identity = self.inkbox.get_identity(self.agent_handle)
            logger.info(f"Using existing identity: {self.agent_handle}")
        except Exception:
            logger.info(f"Creating new identity: {self.agent_handle}")
            self.identity = self.inkbox.create_identity(
                self.agent_handle,
                display_name="Daily Briefing Agent",
            )
            # Provision phone number
            self.identity.provision_phone_number()
            logger.info(f"Provisioned phone number for {self.agent_handle}")
    
    async def generate_briefing_content(self) -> BriefingContent:
        """Generate personalized briefing content"""
        now = datetime.now()
        
        # Generate greeting based on time
        hour = now.hour
        if hour < 12:
            greeting = "Good morning"
        elif hour < 17:
            greeting = "Good afternoon"
        else:
            greeting = "Good evening"
        
        # In a real implementation, these would fetch from actual APIs
        calendar_events = self._get_calendar_events()
        news_items = self._get_news_items()
        weather = self._get_weather()
        priorities = self._get_priorities()
        
        return BriefingContent(
            greeting=greeting,
            calendar_events=calendar_events,
            news_items=news_items,
            weather=weather,
            priorities=priorities,
            closing="That's your briefing. Have a great day!",
        )
    
    def _get_calendar_events(self) -> list[str]:
        """Get today's calendar events (mock implementation)"""
        # In real implementation, integrate with Google Calendar, Outlook, etc.
        return [
            "Team standup at 9 AM",
            "Lunch with Sarah at 12:30 PM",
            "Project review at 3 PM",
        ]
    
    def _get_news_items(self) -> list[str]:
        """Get relevant news items (mock implementation)"""
        # In real implementation, integrate with news APIs
        return [
            "Tech stocks rallied 2% overnight",
            "New AI breakthrough announced by leading research lab",
        ]
    
    def _get_weather(self) -> str:
        """Get weather forecast (mock implementation)"""
        # In real implementation, integrate with weather API
        return "Sunny with a high of 72 degrees"
    
    def _get_priorities(self) -> list[str]:
        """Get user's priorities for the day (mock implementation)"""
        # In real implementation, fetch from task management system
        return [
            "Finish quarterly report",
            "Review pull requests",
            "Prepare for client meeting",
        ]
    
    def format_briefing_script(self, content: BriefingContent) -> str:
        """Format briefing content into a script for AI voice"""
        lines = [
            f"{content.greeting}! Here's your {self.preferences.max_duration_seconds // 60}-minute briefing.",
        ]
        
        if "calendar" in self.preferences.topics and content.calendar_events:
            lines.append("First, your calendar:")
            for event in content.calendar_events[:3]:  # Limit to top 3
                lines.append(f"- {event}")
        
        if "news" in self.preferences.topics and content.news_items:
            lines.append("Today's top news:")
            for item in content.news_items[:2]:  # Limit to top 2
                lines.append(f"- {item}")
        
        if "weather" in self.preferences.topics:
            lines.append(f"Weather: {content.weather}")
        
        if "priorities" in self.preferences.topics and content.priorities:
            lines.append("Your priorities for today:")
            for priority in content.priorities[:3]:  # Limit to top 3
                lines.append(f"- {priority}")
        
        lines.append(content.closing)
        
        return "\n".join(lines)
    
    async def deliver_briefing(self):
        """Deliver the briefing via phone call"""
        if not self.preferences.enabled:
            logger.info("Briefing disabled, skipping")
            return
        
        logger.info(f"Delivering briefing to {self.user_phone}")
        
        # Generate content
        content = await self.generate_briefing_content()
        script = self.format_briefing_script(content)
        
        logger.info(f"Briefing script:\n{script}")
        
        # In real implementation, place call with AI voice
        # This would use Inkbox's hosted agent mode with voice
        try:
            # call = self.identity.place_call(
            #     to_number=self.user_phone,
            #     hosted=True,
            #     reason=script,
            #     authority_mode="yolo",
            # )
            # logger.info(f"Call initiated: {call.id}")
            logger.info("Call would be placed here in production")
        except Exception as e:
            logger.error(f"Failed to place call: {e}")
    
    async def process_sms_command(self, from_number: str, text: str):
        """Process SMS commands to update preferences"""
        if from_number != self.user_phone:
            logger.warning(f"Ignoring SMS from unknown number: {from_number}")
            return
        
        text_lower = text.lower().strip()
        logger.info(f"Processing command: {text_lower}")
        
        if text_lower.startswith("add topic"):
            topic = text_lower.replace("add topic", "").strip()
            if topic and topic not in self.preferences.topics:
                self.preferences.topics.append(topic)
                logger.info(f"Added topic: {topic}")
        
        elif text_lower.startswith("remove topic"):
            topic = text_lower.replace("remove topic", "").strip()
            if topic in self.preferences.topics:
                self.preferences.topics.remove(topic)
                logger.info(f"Removed topic: {topic}")
        
        elif text_lower.startswith("set time"):
            time_str = text_lower.replace("set time", "").strip()
            # Validate time format
            try:
                datetime.strptime(time_str, "%H:%M")
                self.preferences.briefing_time = time_str
                logger.info(f"Set briefing time to: {time_str}")
            except ValueError:
                logger.error(f"Invalid time format: {time_str}")
        
        elif text_lower == "skip today":
            self.preferences.enabled = False
            logger.info("Skipping today's briefing")
            # Re-enable for tomorrow
            asyncio.create_task(self._reenable_tomorrow())
        
        elif text_lower.startswith("duration"):
            try:
                duration = int(text_lower.replace("duration", "").strip())
                if 30 <= duration <= 120:
                    self.preferences.max_duration_seconds = duration
                    logger.info(f"Set max duration to: {duration}s")
                else:
                    logger.error("Duration must be between 30 and 120 seconds")
            except ValueError:
                logger.error("Invalid duration format")
        
        else:
            logger.warning(f"Unknown command: {text_lower}")
    
    async def _reenable_tomorrow(self):
        """Re-enable briefings for tomorrow"""
        await asyncio.sleep(86400)  # 24 hours
        self.preferences.enabled = True
        logger.info("Briefings re-enabled")
    
    def schedule_briefing(self):
        """Schedule daily briefing at the preferred time"""
        schedule.every().day.at(self.preferences.briefing_time).do(
            lambda: asyncio.create_task(self.deliver_briefing())
        )
        logger.info(f"Scheduled briefing for {self.preferences.briefing_time}")
    
    async def run_scheduler(self):
        """Run the scheduling loop"""
        self.schedule_briefing()
        
        while True:
            schedule.run_pending()
            await asyncio.sleep(60)  # Check every minute
    
    async def start(self):
        """Start the briefing agent"""
        await self.initialize()
        
        # Start scheduler in background
        scheduler_task = asyncio.create_task(self.run_scheduler())
        
        # In real implementation, also set up SMS webhook listener
        logger.info("Briefing agent started")
        
        try:
            await scheduler_task
        except asyncio.CancelledError:
            logger.info("Briefing agent stopped")
        finally:
            if self.inkbox:
                self.inkbox.close()


async def main():
    """Main entry point"""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    
    api_key = os.environ.get("INKBOX_API_KEY")
    if not api_key:
        raise ValueError("INKBOX_API_KEY environment variable required")
    
    user_phone = os.environ.get("YOUR_PHONE_NUMBER")
    if not user_phone:
        raise ValueError("YOUR_PHONE_NUMBER environment variable required")
    
    briefing_time = os.environ.get("BRIEFING_TIME", "08:00")
    
    agent = BriefingAgent(
        api_key=api_key,
        user_phone=user_phone,
        briefing_time=briefing_time,
    )
    
    await agent.start()


if __name__ == "__main__":
    asyncio.run(main())
