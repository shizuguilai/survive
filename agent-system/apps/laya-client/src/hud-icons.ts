/** Small native Laya pictograms; no DOM or external font-glyph dependency. */
export function drawIcon(parent:any,kind:string,x:number,y:number,size=22):any{
  const L=(globalThis as any).Laya,s=new L.Sprite();s.pos(x,y);s.scale(size/24,size/24);s.mouseEnabled=false;parent.addChild(s);const g=s.graphics;
  if(kind==='wood'){for(let i=0;i<3;i++){g.drawRoundRect(3+i*3,4+i*5,14,6,2,2,2,2,'#b48a58');g.drawCircle(5+i*3,7+i*5,2.5,'#e1bf84');}}
  else if(kind==='stone')g.drawPoly(0,0,[3,18,5,8,13,3,21,11,20,20,9,22],'#a9b3b4','#d1d2bb',1);
  else if(kind==='food'){g.drawLine(11,8,17,3,'#a8b47c',3);for(const [cx,cy]of [[7,12],[16,12],[12,19]])g.drawCircle(cx,cy,4.5,'#d7937b');}
  else if(kind==='health')g.drawPoly(0,0,[12,21,3,12,2,7,5,3,9,3,12,6,15,3,19,3,22,7,21,12],'#db8c82');
  else if(kind==='hunger'){g.drawPie(12,11,10,0,180,'#d4b77d');g.drawLine(3,10,21,10,'#f0dca8',2);g.drawLine(7,4,8,7,'#d4b77d',2);g.drawLine(14,3,15,6,'#d4b77d',2);}
  else if(kind==='mood'){g.drawCircle(12,12,10,'#b8c79c');g.drawCircle(9,9,1.2,'#354238');g.drawCircle(15,9,1.2,'#354238');g.drawLines(0,0,[7,14,9,16,15,16,17,14],'#354238',1.5);}
  else if(kind==='fatigue'){g.drawCircle(11,12,10,'#9eb7cf');g.drawCircle(15,8,8,'#343e41');}
  else if(kind==='bag'){g.drawRoundRect(4,7,16,15,3,3,3,3,'#bfaa79');g.drawRect(8,3,8,5,null,'#d7c698',2);g.drawRect(7,14,10,5,'#82704e');}
  else if(kind==='house'){g.drawPoly(0,0,[1,10,12,1,23,10],'#c8b78a');g.drawRect(4,10,16,12,'#b19465');g.drawRect(10,15,5,7,'#424e46');}
  else{g.drawCircle(12,12,9,null,'#b5c2b1',2);g.drawCircle(12,12,3,'#d5deb9');}
  return s;
}
