import ctypes
import json
import unittest
from detection import describe_objects

class Vision:
    def __init__(self, text): self._buffer = ctypes.create_string_buffer(text.encode())
    def describe(self, *_args, **_kwargs): return json.loads(self._buffer.value)

class DetectionTests(unittest.TestCase):
    def test_native_negative_nan_does_not_abort_valid_character(self):
        result, warnings, raw = describe_objects(Vision('{"objects":[{"name":"building","bbox":[0,0,10,10],"score":-nan},{"name":"man","bbox":[100,100,900,950],"score":0.761}]}'), 'frame.png')
        self.assertEqual([item['name'] for item in result['objects']], ['man'])
        self.assertEqual(result['objects'][0]['score'], .761)
        self.assertTrue(warnings)
        self.assertIn('-nan', raw)
    def test_names_and_descriptions_are_not_rewritten(self):
        result, _, _ = describe_objects(Vision('{"objects":[{"name":"banana nan -inf","bbox":[0,0,900,900],"score":0.8,"description":{"text":"NaN infinity"}},{"bbox":[0,0,1,1],"score":-nan}]}'), 'frame.png')
        self.assertEqual(result['objects'][0]['name'], 'banana nan -inf')
        self.assertEqual(result['objects'][0]['description']['text'], 'NaN infinity')
    def test_valid_response_is_unchanged(self):
        result, warnings, raw = describe_objects(Vision('{"objects":[{"name":"tiger","bbox":[0,0,1000,1000],"score":0.8}]}'), 'frame.png')
        self.assertEqual(len(result['objects']), 1); self.assertEqual(warnings, []); self.assertIsNone(raw)
    def test_invalid_numbers_and_coordinates_do_not_get_confidence(self):
        result, warnings, _ = describe_objects(Vision('{"objects":[{"bbox":[0,0,10,10],"score":Infinity},{"bbox":[0,0,NaN,10],"score":0.8},{"bbox":[0,0,10,10],"score":true}]}'), 'frame.png')
        self.assertEqual(result['objects'], []); self.assertTrue(warnings)
    def test_malformed_non_numeric_json_is_not_guessed(self):
        with self.assertRaises(json.JSONDecodeError): describe_objects(Vision('{"objects":broken}'), 'frame.png')
    def test_wrong_root_type_is_rejected(self):
        with self.assertRaises(ValueError): describe_objects(Vision('[]'), 'frame.png')
    def test_missing_confidence_is_excluded(self):
        result, warnings, _ = describe_objects(Vision('{"objects":[{"name":"tiger","bbox":[0,0,900,900]}]}'), 'frame.png')
        self.assertEqual(result['objects'], []); self.assertTrue(warnings)

if __name__ == '__main__': unittest.main()
