import type {Point} from './geometry';
export type StabilityState='searching'|'stabilizing'|'ready';
export class QuadStability{
 private good=0;private bad=0;private state:StabilityState='searching';
 update(candidate:Point[]|null,valid:boolean){
  if(candidate&&valid){this.good++;this.bad=0;if(this.good>=4)this.state='ready';else if(this.good>=2)this.state='stabilizing';}
  else{this.bad++;this.good=0;if(this.bad>=2)this.state='searching';}
  return this.state;
 }
 reset(){this.good=0;this.bad=0;this.state='searching';}
 get current(){return this.state;}
}