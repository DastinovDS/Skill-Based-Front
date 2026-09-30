"""Client-server message models, fixtures and test vectors.

- ``gow_protocol.messages``: ``ClientMsg``, ``ServerMsg``, ``PROTOCOL_VERSION``;
- ``gow_protocol.commands``: the commands inside ``command`` messages;
- ``gow_protocol.view``: the player's view inside ``snapshot`` messages;
- ``gow_protocol.ruleset``: ``RulesetPublic`` inside ``welcome``;
- ``gow_protocol.codec``: frames <-> messages.

Fixtures of typical messages (used by the client's tests) are in ``packages/protocol/fixtures/``.
"""

from gow_protocol.messages import PROTOCOL_VERSION

__all__ = ["PROTOCOL_VERSION"]
