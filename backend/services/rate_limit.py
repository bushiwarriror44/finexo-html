import time
from collections import defaultdict, deque
from functools import wraps

from flask import jsonify, request


_BUCKETS = defaultdict(deque)


def rate_limit(max_calls: int, period_seconds: int):
    def decorator(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            key = f"{request.remote_addr}:{request.path}"
            now = time.time()
            bucket = _BUCKETS[key]

            while bucket and now - bucket[0] > period_seconds:
                bucket.popleft()
            if len(bucket) >= max_calls:
                return jsonify({"error": "rate limit exceeded"}), 429

            bucket.append(now)
            return func(*args, **kwargs)

        return wrapped

    return decorator
