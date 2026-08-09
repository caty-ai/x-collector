# Community source format

Each `*.json` file describes one discoverable X source. It does not subscribe any deployment to that source.

```json
{
  "schema_version": 1,
  "platform": "x",
  "identifier": "OpenAI",
  "topic": "AI lab announcements",
  "language": "en",
  "submitted_by": "shojikumaru",
  "first_seen": "2026-08-02"
}
```

The filename must be `x--<lowercased-identifier>.json`. Files use UTF-8 without a BOM, are limited to 2 KiB, and must contain exactly the fields shown above. See [`docs/community-sources.md`](../../docs/community-sources.md) for validation rules and contribution instructions.
