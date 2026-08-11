"""Fan-out event bus backing the Server-Sent Events stream."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator


class EventBus:
    """Broadcasts indexing events to every connected client.

    Each subscriber gets a bounded queue; a slow client drops old frames rather
    than stalling the indexer.
    """

    def __init__(self, max_queue: int = 64) -> None:
        self._subscribers: set[asyncio.Queue[dict]] = set()
        self._max_queue = max_queue
        self._last_event: dict | None = None

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    @property
    def last_event(self) -> dict | None:
        return self._last_event

    async def publish(self, event: dict) -> None:
        self._last_event = event
        for queue in list(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:  # pragma: no cover - defensive
                pass

    async def stream(self) -> AsyncIterator[str]:
        """Yield SSE frames until the client disconnects."""
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers.add(queue)
        try:
            if self._last_event is not None:
                yield _frame(self._last_event)
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield _frame(event)
        finally:
            self._subscribers.discard(queue)


def _frame(event: dict) -> str:
    return f"event: {event.get('type', 'progress')}\ndata: {json.dumps(event)}\n\n"
