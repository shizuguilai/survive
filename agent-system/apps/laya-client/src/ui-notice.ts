/** UI time is independent from the simulation clock: paused worlds can dismiss notices. */
export class UiNotice{
 private value='';private until=0;private queued=false;
 show(text:string,now:number,queued=false):void{this.value=text;this.until=now+4500;this.queued=queued;}
 read(now:number,pending:number):string{if(now>=this.until||(this.queued&&pending===0))this.value='';return this.value;}
}
