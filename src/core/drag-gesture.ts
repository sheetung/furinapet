/** Clicks stay in the webview; only deliberate movement enters native dragging. */
export class DragGesture {
  private pending: {id:number;x:number;y:number}|null=null;
  constructor(private readonly threshold=5) {}
  down(id:number,button:number,x:number,y:number) {
    if(button===0 && !this.pending)this.pending={id,x,y};
  }
  move(id:number,buttons:number,x:number,y:number):boolean {
    const start=this.pending;
    if(!start || start.id!==id)return false;
    if(!(buttons&1)){this.pending=null;return false;}
    if(Math.hypot(x-start.x,y-start.y)<this.threshold)return false;
    this.pending=null;
    return true;
  }
  end(id:number){if(this.pending?.id===id)this.pending=null;}
}
