import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourceText=fs.readFileSync(new URL('../cmd/nas-photo/web/viewer.js', import.meta.url),'utf8');
const start=sourceText.indexOf('let activePhotoMorph = null;');
const end=sourceText.indexOf('function takeViewerSwipePreview(');
assert.ok(start>=0 && end>start,'photo morph functions available');
const morphText=sourceText.slice(start,end);

function fixture(kind='image', motion='no-preference') {
  const events=[];
  const elements=[];
  const stage={style:{visibility:''}};
  const item={id:'i1',kind,width:4000,height:3000};
  const tile={dataset:{id:'i1'}};
  const thumbnail={
    complete:true,naturalWidth:480,naturalHeight:360,
    currentSrc:'https://example.invalid/thumb.jpg',src:'https://example.invalid/thumb.jpg',
    style:{visibility:''},
    closest: selector => selector==='.tile'?tile:null,
    getBoundingClientRect: ()=>({left:50,top:80,right:250,bottom:280,width:200,height:200})
  };
  const pane={getBoundingClientRect: ()=>({left:0,top:0,width:1200,height:800})};
  const slide={closest: selector => selector==='.pane'?pane:null};
  let opens=0,closes=0;
  let hidden=false;
  let reduced=motion==='reduce';
  let lastAnimation;
  function makeGhost(){
    const handlers={};
    const ghost={
      className:'',alt:'',draggable:false,decoding:'',style:{},
      src:'',removed:false,
      remove(){this.removed=true;},
      animate(frames,options){
        const animation={
          frames,options,
          addEventListener(name,fn){handlers[name]=fn;},
          finish(){handlers.finish?.();},
          cancel(){handlers.cancel?.();}
        };
        ghost.animation=animation;lastAnimation=animation;
        return animation;
      }
    };
    elements.push(ghost);
    return ghost;
  }
  const state={viewer:['i1'],viewerTransitionSourceId:'i1',zoom:[{scale:1}],split:false};
  const doc={
    hidden:false,
    documentElement:{},
    body:{append(element){events.push('append');}},
    createElement:tag=>{assert.equal(tag,'img');return makeGhost();}
  };
  const ctx={
    document:doc,window:{matchMedia:()=>({matches:reduced})},
    embeddedMode:false,state,innerWidth:1400,innerHeight:900,
    CSS:{escape:x=>x},
    app:{},
    findItem:id=>id==='i1'?item:null,
    openViewer:id=>{opens++;state.viewer[0]=id;},
    leaveViewer:()=>{closes++;state.viewer[0]=null;},
    containedMediaSize:(containerWidth,containerHeight,width,height)=>{
      const f=Math.min(containerWidth/width,containerHeight/height);
      return {width:width*f,height:height*f};
    },
    getComputedStyle:element=>({
      borderRadius:element===tile?'10px':'0px',
      getPropertyValue:name=>name.includes('duration')?'180ms':'cubic-bezier(.22,.8,.2,1)'
    }),
    cssTimeMilliseconds:text=>parseFloat(text),
    $:(selector,scope)=>{
      if(selector.startsWith('img:not(')&&scope===tile)return thumbnail;
      if(selector.startsWith('.tile[data-id='))return tile;
      if(selector==='.viewer .swipe-slide-current')return slide;
      if(selector==='.viewer .swipe-slide-current .viewer-image-stage')return stage;
      return null;
    }
  };
  const api=vm.runInNewContext(morphText+'\n;({openViewerFromTile,leaveViewerWithTransition,animateGalleryPhoto,viewerPhotoRect})',ctx);
  return {api,item,tile,thumbnail,stage,elements,events,state,
    get opens(){return opens;},get closes(){return closes;},
    get anim(){return lastAnimation;},set reduced(v){reduced=v;},
    set hidden(v){hidden=v;doc.hidden=v;}
  };
}

test('opens photo by morphing only one thumbnail, without View Transitions',()=>{
  const f=fixture();
  f.api.openViewerFromTile(f.tile);
  assert.equal(f.opens,1);
  assert.equal(f.elements.length,1);
  const ghost=f.elements[0];
  assert.equal(ghost.src,f.thumbnail.currentSrc);
  assert.equal(ghost.className,'nas-photo-photo-morph');
  assert.equal(ghost.animation.frames[0].width,'200px');
  assert.equal(ghost.animation.frames[0].borderRadius,'10px');
  assert.equal(ghost.animation.frames[1].width,'1066.6666666666667px');
  assert.equal(ghost.animation.frames[1].height,'800px');
  assert.equal(ghost.animation.frames[1].borderRadius,'0px');
  assert.equal(f.stage.style.visibility,'hidden');
  f.anim.finish();
  assert.equal(ghost.removed,true);
  assert.equal(f.stage.style.visibility,'');
  assert.doesNotMatch(sourceText,/document\.startViewTransition\(/);
});

test('closes with the reverse geometry/radius and restores gallery image',()=>{
  const f=fixture();
  f.api.leaveViewerWithTransition();
  assert.equal(f.closes,1);
  assert.equal(f.anim.frames[0].width,'1066.6666666666667px');
  assert.equal(f.anim.frames[0].height,'800px');
  assert.equal(f.anim.frames[0].borderRadius,'0px');
  assert.equal(f.anim.frames[1].width,'200px');
  assert.equal(f.anim.frames[1].borderRadius,'10px');
  assert.equal(f.thumbnail.style.visibility,'hidden');
  f.anim.finish();
  assert.equal(f.thumbnail.style.visibility,'');
  assert.equal(f.elements[0].removed,true);
});

test('videos and unavailable thumbnails open immediately',()=>{
  const video=fixture('video');
  video.api.openViewerFromTile(video.tile);
  assert.equal(video.opens,1);
  assert.equal(video.elements.length,0);
  const photo=fixture();
  photo.thumbnail.complete=false;
  photo.api.openViewerFromTile(photo.tile);
  assert.equal(photo.opens,1);
  assert.equal(photo.elements.length,0);
});

test('hidden tabs avoid unnecessary animations',()=>{
  const hidden=fixture();
  hidden.hidden=true;
  hidden.api.openViewerFromTile(hidden.tile);
  assert.equal(hidden.opens,1);
  assert.equal(hidden.elements.length,0);
});

test('zoomed photos do not morph onto an unzoomed thumbnail',()=>{
  const f=fixture();
  f.state.zoom[0].scale=2;
  f.api.leaveViewerWithTransition();
  assert.equal(f.closes,1);
  assert.equal(f.elements.length,0);
});

test('rapid transitions cancel previous overlay and restore visibility',()=>{
  const f=fixture();
  f.api.openViewerFromTile(f.tile);
  const first=f.elements[0];
  assert.equal(f.stage.style.visibility,'hidden');
  f.api.openViewerFromTile(f.tile);
  assert.equal(first.removed,true);
  assert.equal(f.elements.length,2);
  assert.equal(f.stage.style.visibility,'hidden');
  f.anim.finish();
  assert.equal(f.stage.style.visibility,'');
});

test('incomplete metadata dimensions use image dimensions as a pair',()=>{
  const f=fixture();
  f.item.height=0;
  const pane={getBoundingClientRect:()=>({left:20,top:10,width:1000,height:750})};
  const fitted=f.api.viewerPhotoRect(f.item,pane,f.thumbnail);
  assert.ok(Math.abs(fitted.width-1000)<0.001);
  assert.ok(Math.abs(fitted.height-750)<0.001);
});

test('CSS configures only the thumbnail morph, no full-screen snapshots',()=>{
  const css=fs.readFileSync(new URL('../cmd/nas-photo/web/viewer.css', import.meta.url),'utf8');
  assert.match(css,/--nas-gallery-photo-morph-duration:\s*180ms/);
  assert.match(css,/\.nas-photo-photo-morph/);
  assert.doesNotMatch(css,/::view-transition-/);
  assert.doesNotMatch(css,/view-transition-name/);
});
