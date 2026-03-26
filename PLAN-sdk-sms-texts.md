# Plan: Add SMS/Text Message Support to Python + TypeScript SDKs

Depends on server-side endpoints already deployed:
- `GET/PATCH /phone/numbers/{id}/texts`
- `GET /phone/numbers/{id}/texts/conversations`
- `GET /phone/numbers/{id}/texts/conversations/{remote_number}`

---

## Python SDK (`sdk/python/inkbox/phone/`)

### 1. Types — `phone/types.py`
Add alongside existing `PhoneCall`, `PhoneNumber`, etc.:
- `TextMediaItem` — `content_type`, `size`, `url` (presigned S3)
- `TextMessage` — `id`, `direction` (inbound/outbound), `local_phone_number`, `remote_phone_number`, `text`, `type` (sms/mms), `media: list[TextMediaItem] | None`, `status`, `is_read`, timestamps
- `TextConversationSummary` — `remote_phone_number`, `latest_text`, `latest_direction`, `latest_type`, `latest_message_at`, `unread_count`, `total_count`
- All with `_from_dict()` classmethods following existing pattern

### 2. Resource — `phone/resources/texts.py`
New `TextsResource(http)` class:

| Method | Server Endpoint | Returns |
|--------|----------------|---------|
| `list(phone_number_id, *, limit, offset, is_read)` | `GET /numbers/{id}/texts` | `list[TextMessage]` |
| `get(phone_number_id, text_id)` | `GET /numbers/{id}/texts/{text_id}` | `TextMessage` |
| `update(phone_number_id, text_id, *, is_read, status)` | `PATCH /numbers/{id}/texts/{text_id}` | `TextMessage` |
| `search(phone_number_id, *, q, limit)` | `GET /numbers/{id}/texts/search` | `list[TextMessage]` |
| `list_conversations(phone_number_id, *, limit, offset)` | `GET /numbers/{id}/texts/conversations` | `list[TextConversationSummary]` |
| `get_conversation(phone_number_id, remote_number, *, limit, offset)` | `GET /numbers/{id}/texts/conversations/{remote}` | `list[TextMessage]` |
| `update_conversation(phone_number_id, remote_number, *, is_read)` | `PATCH /numbers/{id}/texts/conversations/{remote}` | `dict` |

### 3. Client wiring — `client.py`
- `self._texts = TextsResource(self._phone_http)`
- Expose as `inkbox.texts` property

### 4. AgentIdentity convenience — `agent_identity.py`
Scoped to the identity's phone number:
- `list_texts(limit, offset, is_read)`
- `get_text(text_id)`
- `list_text_conversations(limit, offset)`
- `get_text_conversation(remote_number, limit, offset)`

### 5. Tests — `tests/test_texts.py`
Mock HttpTransport, verify correct endpoint paths and param passing, verify type parsing.

---

## TypeScript SDK (`sdk/typescript/src/phone/`)

### 6. Types — `phone/types.ts`
- `TextMediaItem`, `TextMessage`, `TextConversationSummary` interfaces
- `RawTextMessage`, `RawTextMediaItem`, `RawTextConversationSummary` raw types (snake_case from API)
- `parseTextMessage()`, `parseTextMediaItem()`, `parseTextConversationSummary()` parser functions

### 7. Resource — `phone/resources/texts.ts`
`TextsResource` — mirrors Python methods with async/await.

### 8. Client wiring — `inkbox.ts`
- Same pattern as Python

### 9. AgentIdentity convenience — `agent_identity.ts`
- Same methods as Python, all async

### 10. Tests — `tests/phone/texts.test.ts`
Vitest with mocked HttpTransport.

---

---

## CLI (`cli/src/`)

### 11. Text command — `commands/text.ts`
New `registerTextCommands(program)` under `inkbox text` subcommand:

| Command | Description | Flags |
|---------|-------------|-------|
| `inkbox text list` | List texts for an identity's phone number | `-i --identity`, `--limit`, `--offset`, `--unread-only` |
| `inkbox text get <text-id>` | Get a single text message | `-i --identity` |
| `inkbox text conversations` | List conversation summaries | `-i --identity`, `--limit`, `--offset` |
| `inkbox text conversation <remote-number>` | Get messages in a conversation | `-i --identity`, `--limit`, `--offset` |
| `inkbox text search` | Full-text search across texts | `-i --identity`, `--query`, `--limit` |
| `inkbox text mark-read <text-id>` | Mark a text as read | `-i --identity` |
| `inkbox text mark-conversation-read <remote-number>` | Mark all texts in a conversation as read | `-i --identity` |

### 12. Wire into index — `index.ts`
- Import and call `registerTextCommands(program)`

---

## Files to create

- `sdk/python/inkbox/phone/resources/texts.py`
- `sdk/python/tests/test_texts.py`
- `sdk/typescript/src/phone/resources/texts.ts`
- `sdk/typescript/tests/phone/texts.test.ts`
- `cli/src/commands/text.ts`

## Files to modify

- `sdk/python/inkbox/phone/types.py` — add Text* types
- `sdk/python/inkbox/phone/__init__.py` — export texts
- `sdk/python/inkbox/client.py` — wire TextsResource
- `sdk/python/inkbox/agent_identity.py` — add convenience methods
- `sdk/typescript/src/phone/types.ts` — add Text* types + parsers
- `sdk/typescript/src/inkbox.ts` — wire TextsResource
- `sdk/typescript/src/agent_identity.ts` — add convenience methods
- `cli/src/index.ts` — register text commands
