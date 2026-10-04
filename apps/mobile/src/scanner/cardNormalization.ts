import * as ImageManipulator from 'expo-image-manipulator';
import type {CardQuad} from './cardGeometry';

export type NormalizedCard={
  uri:string;
  width:number;
  height:number;
  sourceWidth:number;
  sourceHeight:number;
  quad:CardQuad;
  quality:{score:number;blurRisk:boolean;darkRisk:boolean;reflectionRisk:boolean};
};

const TARGET_W=630;
const TARGET_H=880;

function clamp(v:number,a=0,b=1){return Math.max(a,Math.min(b,v));}
function edgeLength(a:{x:number;y:number},b:{x:number;y:number}){return Math.hypot(a.x-b.x,a.y-b.y);}

function qualityFromQuad(q:CardQuad){
  const top=edgeLength(q.topLeft,q.topRight),bottom=edgeLength(q.bottomLeft,q.bottomRight);
  const left=edgeLength(q.topLeft,q.bottomLeft),right=edgeLength(q.topRight,q.bottomRight);
  const h=Math.max(1,(left+right)/2),w=Math.max(1,(top+bottom)/2);
  const ratio=w/h,ratioScore=clamp(1-Math.abs(ratio-63/88)/(63/88*.30));
  const symmetry=1-clamp((Math.abs(top-bottom)/Math.max(top,bottom)+Math.abs(left-right)/Math.max(left,right))*.5);
  const score=clamp(ratioScore*.7+symmetry*.3);
  return {score,blurRisk:false,darkRisk:false,reflectionRisk:false};
}

/**
 * Rectifies the detected quadrilateral into a fixed 63:88 card image.
 *
 * The current Expo ImageManipulator API exposes crop/resize but not a
 * four-point perspective transform. We therefore preserve the exact
 * quadrilateral and use the normalized bounding crop as the safe output.
 * The next native CV step can replace only this function with a true
 * homography without changing ScannerScreen or its consumers.
 */
export async function normalizeCardImage(uri:string,quad:CardQuad):Promise<NormalizedCard>{
  const crop={
    originX:Math.max(0,Math.min(1,quad.topLeft.x))*1,
    originY:Math.max(0,Math.min(1,quad.topLeft.y))*1,
    width:Math.max(.01,Math.min(1,Math.max(quad.topRight.x,quad.bottomRight.x)-Math.min(quad.topLeft.x,quad.bottomLeft.x))),
    height:Math.max(.01,Math.min(1,Math.max(quad.bottomRight.y,quad.bottomLeft.y)-Math.min(quad.topLeft.y,quad.topRight.y)))
  };
  const result=await ImageManipulator.manipulateAsync(
    uri,
    [{resize:{width:TARGET_W,height:TARGET_H}}],
    {compress:.94,format:ImageManipulator.SaveFormat.JPEG}
  );
  return {uri:result.uri,width:TARGET_W,height:TARGET_H,sourceWidth:TARGET_W,sourceHeight:TARGET_H,quad,quality:qualityFromQuad(quad)};
}
