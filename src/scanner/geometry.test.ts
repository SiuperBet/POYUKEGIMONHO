import {describe,expect,it} from 'vitest';
import {clamp,isConvexQuad,polygonArea} from './geometry';
describe('scanner geometry',()=>{it('clamps corners',()=>expect(clamp(120,4,96)).toBe(96));it('computes area',()=>expect(polygonArea([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}])).toBe(10000));it('accepts convex quad',()=>expect(isConvexQuad([{x:0,y:0},{x:100,y:0},{x:95,y:140},{x:5,y:140}])).toBe(true))});
