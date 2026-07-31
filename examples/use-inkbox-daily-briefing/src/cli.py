"""
CLI interface for the daily briefing agent
"""

import asyncio
import logging
import sys

import click

from src.briefing_agent import BriefingAgent
from src.config import Config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


@click.group()
def cli():
    """Daily Briefing Agent - AI voice agent with 2-minute morning briefings"""
    pass


@cli.command()
@click.option("--api-key", envvar="INKBOX_API_KEY", required=True, help="Inkbox API key")
@click.option("--user-phone", envvar="YOUR_PHONE_NUMBER", required=True, help="Your phone number")
@click.option("--briefing-time", envvar="BRIEFING_TIME", default="08:00", help="Briefing time (HH:MM)")
@click.option("--agent-handle", default="daily-briefing", help="Agent handle")
@click.option("--test", is_flag=True, help="Run in test mode (single briefing)")
async def start(api_key: str, user_phone: str, briefing_time: str, agent_handle: str, test: bool):
    """Start the daily briefing agent"""
    # Validate config
    errors = Config.validate()
    if errors:
        for error in errors:
            click.echo(f"Error: {error}", err=True)
        sys.exit(1)
    
    agent = BriefingAgent(
        api_key=api_key,
        user_phone=user_phone,
        briefing_time=briefing_time,
        agent_handle=agent_handle,
    )
    
    if test:
        # Test mode: deliver a single briefing and exit
        await agent.initialize()
        await agent.deliver_briefing()
        if agent.inkbox:
            agent.inkbox.close()
    else:
        # Normal mode: run the scheduler
        await agent.start()


@cli.command()
@click.option("--api-key", envvar="INKBOX_API_KEY", required=True, help="Inkbox API key")
@click.option("--user-phone", envvar="YOUR_PHONE_NUMBER", required=True, help="Your phone number")
@click.option("--agent-handle", default="daily-briefing", help="Agent handle")
async def test_briefing(api_key: str, user_phone: str, agent_handle: str):
    """Generate and display a test briefing without calling"""
    agent = BriefingAgent(
        api_key=api_key,
        user_phone=user_phone,
        agent_handle=agent_handle,
    )
    
    await agent.initialize()
    content = await agent.generate_briefing_content()
    script = agent.format_briefing_script(content)
    
    click.echo("=" * 60)
    click.echo("TEST BRIEFING SCRIPT")
    click.echo("=" * 60)
    click.echo(script)
    click.echo("=" * 60)
    
    # Check duration
    from src.duration_controller import DurationController
    controller = DurationController(max_duration_seconds=120)
    is_valid, duration = controller.validate_script(script)
    
    click.echo(f"\nEstimated duration: {duration:.1f} seconds")
    if is_valid:
        click.echo("✓ Script fits within 2-minute limit")
    else:
        click.echo("✗ Script exceeds 2-minute limit")
    
    if agent.inkbox:
        agent.inkbox.close()


@cli.command()
def validate():
    """Validate configuration"""
    errors = Config.validate()
    if errors:
        click.echo("Configuration errors:", err=True)
        for error in errors:
            click.echo(f"  - {error}", err=True)
        sys.exit(1)
    else:
        click.echo("✓ Configuration is valid")


if __name__ == "__main__":
    cli()
