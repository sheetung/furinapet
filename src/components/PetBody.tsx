import {Component,lazy,Suspense,useState,type ReactNode} from 'react';
const RiggedPet=lazy(()=>import('./RiggedPet'));
class AssetBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onError();}
  render(){return this.state.failed?null:this.props.children;}
}
/** Shared by the native PetView and browser integration harness. */
export function PetBody({enabled,reaction,scale,fallback,assetUrl}:{enabled:boolean;reaction:string;scale:number;fallback:ReactNode;assetUrl?:string}) {
  const [ready,setReady]=useState(false);
  return <>
    <div data-body-backend={enabled&&ready?'rigged':'legacy'} style={{visibility:enabled&&ready?'hidden':'visible'}}>{fallback}</div>
    {enabled&&<AssetBoundary key={assetUrl??'default'} onError={()=>setReady(false)}><Suspense fallback={null}>
      <div style={{visibility:ready?'visible':'hidden'}}><RiggedPet reaction={reaction} scale={scale} onStatus={setReady} assetUrl={assetUrl}/></div>
    </Suspense></AssetBoundary>}
  </>;
}
