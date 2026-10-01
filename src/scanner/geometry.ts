export type Point={x:number;y:number};
export type QuadStabilityState='searching'|'stabilizing'|'ready';
export type QuadStability={good:number;bad:number;state:QuadStabilityState};
export const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
export function polygonArea(points:Point[]):number{if(points.length<3)return 0;let sum=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=a.x*b.y-b.x*a.y}return Math.abs(sum)/2}
export function isConvexQuad(points:Point[]):boolean{if(points.length!==4)return false;let sign=0;for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(cross)<.001)continue;const s=Math.sign(cross);if(sign&&s!==sign)return false;sign=s}return sign!==0}
export function updateQuadStability(prev:QuadStability,valid:boolean):QuadStability{if(valid){const good=prev.good+1;return {good,bad:0,state:good>=4?'ready':good>=2?'stabilizing':'searching'}}const bad=prev.bad+1;return {good:0,bad,state:bad>=2?'searching':prev.state}}
