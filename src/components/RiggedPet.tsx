import {useEffect,useRef} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../../characters/furina/model/furina.skinned.glb?url';
import {GlbBody,disposeGlb} from '../neuro/motion/glb-body';
import {subscribeRigPlans} from '../neuro/motion/rigged-bridge';

export default function RiggedPet({reaction,scale,onStatus,assetUrl=modelUrl}:{reaction:string;scale:number;onStatus:(ready:boolean)=>void;assetUrl?:string}) {
  const host=useRef<HTMLDivElement>(null);
  const reactionRef=useRef(reaction);reactionRef.current=reaction;
  const statusRef=useRef(onStatus);statusRef.current=onStatus;
  useEffect(()=>{
    let disposed=false;let failed=false;let body:GlbBody|undefined;let renderer:THREE.WebGLRenderer|undefined;
    let unsubscribe=()=>{};let previous=performance.now();let ready=false;
    const pointer={x:0,y:0};
    const status=(value:boolean)=>{if(ready!==value){ready=value;statusRef.current(value);}};
    statusRef.current(false);
    const move=(event:PointerEvent)=>{pointer.x=event.clientX/window.innerWidth*2-1;pointer.y=1-event.clientY/window.innerHeight*2;};
    const fail=()=>{failed=true;unsubscribe();status(false);renderer?.setAnimationLoop(null);};
    const lost=(event:Event)=>{event.preventDefault();fail();};
    const scene=new THREE.Scene();const camera=new THREE.OrthographicCamera(-1.1,1.1,1.2,-1.2,.01,30);
    camera.position.set(0,1.1,6);camera.lookAt(0,1.1,0);
    try {
      renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(192,208);
      host.current!.append(renderer.domElement);renderer.domElement.addEventListener('webglcontextlost',lost);
      window.addEventListener('pointermove',move);
      void new GLTFLoader().loadAsync(assetUrl).then(gltf=>{
        if(disposed||failed){disposeGlb(gltf.scene);return;}
        scene.add(gltf.scene);
        body=new GlbBody(gltf);
        scene.add(body.presentation);
        unsubscribe=subscribeRigPlans(message=>body?.receive(message));
        renderer!.setAnimationLoop(now=>{
          if(document.hidden)return;
          const dt=(now-previous)/1000;previous=now;
          try {body!.reaction(reactionRef.current);body!.update(dt,pointer);renderer!.render(scene,camera);status(true);}
          catch(error){console.warn('[rigged-body] frame failure',error);fail();}
        });
      }).catch(error=>{if(!disposed){console.warn('[rigged-body] load failure',error);status(false);}});
    } catch(error){console.warn('[rigged-body] WebGL unavailable',error);status(false);}
    return ()=>{disposed=true;unsubscribe();window.removeEventListener('pointermove',move);body?.dispose();disposeGlb(scene);
      renderer?.setAnimationLoop(null);renderer?.domElement.removeEventListener('webglcontextlost',lost);renderer?.dispose();renderer?.domElement.remove();};
  },[assetUrl]);
  return <div ref={host} aria-hidden="true" className="rigged-pet" style={{position:'absolute',left:'50%',bottom:0,width:192,height:208,marginLeft:-96,transform:`scale(${scale})`,transformOrigin:'bottom center',pointerEvents:'none'}}/>;
}
