import {describe,it,expect} from 'vitest';
import {DragGesture} from './drag-gesture';

describe('native drag gesture arbitration',()=>{
  it('leaves two clicks and small jitter available for double click',()=>{
    const gesture=new DragGesture();
    for(let i=0;i<2;i++){
      gesture.down(1,0,10,10);
      expect(gesture.move(1,1,12,12)).toBe(false);
      gesture.end(1);
    }
    expect(gesture.move(1,1,40,40)).toBe(false);
  });
  it('starts once when movement crosses the threshold',()=>{
    const gesture=new DragGesture();gesture.down(1,0,0,0);
    expect(gesture.move(1,1,3,4)).toBe(true);
    expect(gesture.move(1,1,20,20)).toBe(false);
  });
  it('ignores secondary buttons and unrelated pointers',()=>{
    const gesture=new DragGesture();gesture.down(1,2,0,0);
    expect(gesture.move(1,2,20,20)).toBe(false);
    gesture.down(1,0,0,0);gesture.down(2,0,50,50);
    gesture.end(2);expect(gesture.move(2,1,80,80)).toBe(false);
    expect(gesture.move(1,1,10,0)).toBe(true);
  });
  it('does not start after release, cancellation or lost capture',()=>{
    const gesture=new DragGesture();gesture.down(1,0,0,0);
    expect(gesture.move(1,0,20,20)).toBe(false);
    expect(gesture.move(1,1,20,20)).toBe(false);
    gesture.down(1,0,0,0);gesture.end(1);
    expect(gesture.move(1,1,20,20)).toBe(false);
    gesture.down(2,0,0,0);expect(gesture.move(2,1,6,0)).toBe(true);
  });
});
