# Daily Briefing Mode

An AI voice agent that calls you in the morning with a personalized 2-minute briefing on your calendar, news, and day ahead.

## Features

- **Scheduled Morning Calls**: Automatically calls at your preferred time
- **2-Minute Constraint**: Briefings are strictly limited to 2 minutes
- **Personalized Content**: Calendar events, news, weather, and priorities
- **SMS Preference Updates**: Text the agent to update briefing preferences
- **Smart Content Selection**: AI prioritizes the most important information

## Setup

1. Install dependencies:
```bash
cd examples/use-inkbox-daily-briefing
pip install -e ".[dev]"
```

2. Configure environment:
```bash
export INKBOX_API_KEY="your_api_key"
export BRIEFING_TIME="08:00"  # Your preferred briefing time
export YOUR_PHONE_NUMBER="+15551234567"
```

3. Run the briefing agent:
```bash
python src/briefing_agent.py
```

## SMS Commands

Text the briefing agent to update preferences:

- `add topic tech` - Add a topic to your briefing
- `remove topic sports` - Remove a topic
- `set time 09:00` - Change briefing time
- `skip today` - Skip today's briefing
- `duration 90` - Set max duration in seconds (max 120)

## Architecture

The briefing agent uses:
- **Inkbox Voice API**: For outbound calls with AI voice
- **Inkbox SMS API**: For preference updates via text
- **Calendar Integration**: Fetches your daily events
- **News API**: Fetches relevant news
- **LLM**: Generates and prioritizes briefing content
- **Duration Controller**: Enforces 2-minute limit

## Example Briefing Flow

1. Agent calls you at scheduled time
2. AI voice delivers: "Good morning! Here's your 2-minute briefing..."
3. Covers: 3 top calendar events, 2 key news items, weather, priorities
4. Ends with: "That's your briefing. Have a great day!"
5. You can text preferences anytime to customize content
