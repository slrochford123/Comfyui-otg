import { describe, expect, it } from 'vitest';
import { applyPromptNodeMapping } from '@/lib/workflows/promptNodeMapping';

describe('workflow prompt node mapping', () => {
  it('uses explicit OTG metadata first', () => {
    const graph: any = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    };
    const result = applyPromptNodeMapping(graph, {
      positive: 'sunrise',
      negative: 'blur',
      otgMeta: { positiveNodeId: '1', negativeNodeId: '2' },
    });
    expect(result).toEqual({ positiveApplied: 1, negativeApplied: 1 });
    expect(graph['1'].inputs.text).toBe('sunrise');
    expect(graph['2'].inputs.text).toBe('blur');
  });

  it('falls back to text-like nodes', () => {
    const graph: any = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    };
    applyPromptNodeMapping(graph, { positive: 'cat', negative: 'noise' });
    expect(graph['1'].inputs.text).toBe('cat');
    expect(graph['2'].inputs.text).toBe('noise');
  });
});
