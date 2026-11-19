"""Conservative adapter for non-finite confidence values from native Mirage JSON."""
import json
import math
import re

# Match JSON strings first so names/descriptions containing 'nan' remain untouched.
_NONFINITE = re.compile(r'"(?:\\.|[^"\\])*"|(?<![\w.])[+-]?(?:nan|infinity|inf)(?![\w.])', re.IGNORECASE)


def describe_objects(vision, image):
    warnings = []
    raw = None
    try:
        prediction = vision.describe(str(image), sections=['objects'], mask_format='polygons', max_objects=12, max_tokens=512)
    except json.JSONDecodeError:
        # The installed native library can emit score:-nan. Never turn that into
        # positive confidence: use null, then reject the affected detection below.
        buffer = getattr(vision, '_buffer', None)
        if buffer is None:
            raise
        raw = buffer.value.decode('utf-8')
        repaired = _NONFINITE.sub(lambda match: match.group() if match.group().startswith('"') else 'null', raw)
        if repaired == raw:
            raise
        prediction = json.loads(repaired, parse_constant=lambda _value: None)
        warnings.append('Detector returned non-finite values; affected detections were excluded, not assigned confidence.')
    if not isinstance(prediction, dict) or not isinstance(prediction.get('objects', []), list):
        raise ValueError('The detector did not return an object list.')
    objects = []
    rejected = 0
    for obj in prediction.get('objects', []):
        if not isinstance(obj, dict):
            rejected += 1
            continue
        score, box = obj.get('score'), obj.get('bbox')
        number = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        if not number(score) or not 0 <= score <= 1 or not isinstance(box, list) or len(box) != 4 or not all(number(value) for value in box):
            rejected += 1
            continue
        objects.append(obj)
    if rejected:
        warnings.append(f'Excluded {rejected} detection(s) with invalid confidence or coordinates. Review the remaining characters or add a frame region manually.')
    return {**prediction, 'objects': objects}, warnings, raw
