# TypeScript Examples

## OpenClaw Skill

[openclaw/](./openclaw/) — Email and phone capabilities as an OpenClaw skill.
Install it into OpenClaw to give your agents an Inkbox identity.

### Setup

1. Get an Inkbox API key.
2. Set the `INKBOX_API_KEY` environment variable in the environment where OpenClaw runs:

```bash
export INKBOX_API_KEY=your_api_key_here
```

3. Make sure the Inkbox skill is installed.
4. Add this config snippet to `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "inkbox": {
        "enabled": true,
        "apiKey": {
          "source": "env",
          "provider": "default",
          "id": "INKBOX_API_KEY"
        }
      }
    }
  }
}
```

5. Start a new OpenClaw session (and restart the gateway if needed).
