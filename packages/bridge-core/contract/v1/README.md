# Protocol v1 frozen fixtures

These fixtures are snapshots of the public v1 contract. Do not alter an
existing fixture: add a new fixture when covering another valid v1 case, and
add a new directory for a later protocol version. The current decoder replays
every `request-*.json` fixture in `envelope-fixtures.test.ts`.

`response-*.json` fixtures are reserved for the Worker endpoint replay. That
replay is added with B5, when `/v1/commands` accepts this envelope.
