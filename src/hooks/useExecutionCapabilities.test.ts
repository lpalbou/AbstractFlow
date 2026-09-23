import { describe, expect, it } from 'vitest';
import { executionRoute } from './useExecutionCapabilities';

describe('execution discovery identity', () => {
  const defaults = {routes:[{key:'input.text', provider:'mlx', model:'target',source:'config'}]};
  it('resolves inherited identity without making it a persisted pin', () => {
    expect(executionRoute('', '', defaults)).toEqual({provider:'mlx',model:'target'});
    expect(executionRoute('huggingface', 'other', defaults)).toEqual({provider:'huggingface',model:'other'});
    expect(executionRoute('huggingface', '', defaults)).toEqual({provider:'huggingface',model:''});
    expect(executionRoute('', 'explicit', defaults)).toEqual({provider:'mlx',model:'explicit'});
  });
  it('does not treat unavailable discovery as a model family guess', () => {
    expect(executionRoute('', '', {})).toEqual({provider:'',model:''});
    expect(executionRoute('', '', {routes:[{key:'input.text',provider:'mlx',model:'target',source:'not_configured'}]})).toEqual({provider:'',model:''});
  });
});
