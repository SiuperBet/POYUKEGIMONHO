import {describe,expect,it} from 'vitest';
import {evaluateQuality} from './quality';
describe('scanner quality gate',()=>{
 it('accepts a plausible frame',()=>expect(evaluateQuality({areaRatio:.48,aspectRatio:.7,brightness:128,contrast:42,edgeConfidence:.8}).ok).toBe(true));
 it('rejects poor brightness',()=>expect(evaluateQuality({areaRatio:.48,aspectRatio:.7,brightness:240,contrast:42,edgeConfidence:.8}).ok).toBe(false));
 it('rejects tiny detection',()=>expect(evaluateQuality({areaRatio:.08,aspectRatio:.7,brightness:128,contrast:42,edgeConfidence:.8}).reasons).toContain('area-too-small'))
})