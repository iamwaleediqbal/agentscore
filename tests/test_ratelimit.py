import asyncio
import time

from agentscore import RateLimiter


async def test_limiter_lets_the_first_burst_through_immediately():
    limiter = RateLimiter(per_minute=5)
    started = time.monotonic()
    await asyncio.gather(*(limiter.acquire() for _ in range(5)))
    assert time.monotonic() - started < 0.2


async def test_limiter_blocks_once_the_window_is_full():
    # Exceeding OpenRouter's per minute cap returns 429s that still count
    # against the daily quota, so the run is paced to the limit rather than
    # racing it and finishing with holes.
    limiter = RateLimiter(per_minute=2)
    await limiter.acquire()
    await limiter.acquire()
    task = asyncio.create_task(limiter.acquire())
    await asyncio.sleep(0.15)
    assert not task.done()
    task.cancel()
