import {describe,expect,it} from 'vitest';
import {clamp,isConvexQuad,polygonArea,updateQuadStability} from './geometry';
describe('scanner geometry',()=>{
 it('clamps corners',()=>expect(clamp(120,4,96)).toBe(96));
 it('computes area',()=>expect(polygonArea([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}])).toBe(10000));
 it('accepts convex quad',()=>expect(isConvexQuad([{x:0,y:0},{x:100,y:0},{x:95,y:140},{x:5,y:140}])).toBe(true));
 it('requires four stable frames',()=>{let s={good:0,bad:0,state:'searching' as const};for(let i=0;i<3;i++)s=updateQuadStability(s,true);expect(s.state).toBe('stabilizing');s=updateQuadStability(s,true);expect(s.state).toBe('ready')});
 it('needs two failures to leave ready',()=>{let s={good:4,bad:0,state:'ready' as const};s=updateQuadStability(s,false);expect(s.state).toBe('ready');s=updateQuadStability(s,false);expect(s.state).toBe('searching')});
});