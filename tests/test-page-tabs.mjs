import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initSectionTabs} from '../js/page-tabs.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('all four routes contain matched accessible notebook tabs',()=>{
  const routes={
    'pages/signaux.html':['technique','macro'],
    'pages/analyse.html':['summary','atr','holdings','news'],
    'pages/inventaire.html':['positions','structure'],
    'pages/parametres.html':['general','alerts','nas','investors','backup']
  };
  for(const [filename,expected] of Object.entries(routes)){
    const page=read(filename);
    assert.match(page,/class="section-tabset"/);
    assert.match(page,/class="section-tabframe/);
    const tabs=[...page.matchAll(/role="tab" data-tab="([^"]+)"/g)].map(match=>match[1]);
    const panels=[...page.matchAll(/data-tab-panel="([^"]+)"/g)].map(match=>match[1]);
    assert.deepEqual(tabs,expected,filename+' tabs');
    assert.deepEqual(panels,expected,filename+' panels');
    for(const name of expected){
      assert.match(page,new RegExp('id="[^"]+-tab-'+name+'"|id="settings-tab-'+name+'"'));
      assert.match(page,new RegExp('role="tabpanel" data-tab-panel="'+name+'"|data-tab-panel="'+name+'"[^>]*role="tabpanel"'));
    }
  }
});

test('folder tab controller toggles only one panel and supports arrow/Home/End',()=>{
  const listeners=[];
  const saved=new Map();
  globalThis.sessionStorage={
    getItem:key=>saved.get(key)||null,
    setItem:(key,val)=>saved.set(key,val)
  };
  const tabs=['a','b','c'].map(name=>({
    id:'tab-'+name,dataset:{tab:name},tabIndex:null,
    setAttribute(key,val){this[key]=val;},
    addEventListener(name,fn){this[name]=fn;},
    removeEventListener(name){delete this[name];},
    focus(){this.focused=true;},
    scrollIntoView(){this.scrolled=true;}
  }));
  const panels=['a','b','c'].map(name=>({
    id:'panel-'+name,hidden:null,attributes:{},
    classList:{toggle(){}},
    setAttribute(key,val){this.attributes[key]=val;}
  }));
  const root={querySelectorAll(selector){
    if(selector.includes('section-tabbar'))return tabs;
    if(selector.includes('section-tabframe'))return panels;
    throw Error('unknown selector');
  }};
  const cleanup=initSectionTabs(root,'test');
  assert.equal(tabs[0]['aria-selected'],'true');
  assert.equal(panels[0].hidden,false);
  assert.equal(panels[1].hidden,true);
  tabs[0].keydown({key:'ArrowRight',preventDefault(){}});
  assert.equal(tabs[1]['aria-selected'],'true');
  assert.equal(tabs[1].focused,true);
  assert.equal(panels[0].hidden,true);
  assert.equal(panels[1].hidden,false);
  tabs[1].keydown({key:'End',preventDefault(){}});
  assert.equal(panels[2].hidden,false);
  assert.equal(saved.get('alphaTerm_tabs_test'),'c');
  tabs[2].keydown({key:'Home',preventDefault(){}});
  assert.equal(tabs[0]['aria-selected'],'true');
  cleanup();
});

test('notification panel is independently scrollable, timestamps are outside headings',()=>{
  const page=read('index.html');
  const css=read('css/app.css');
  const app=read('js/app.js');
  assert.match(page,/id="notification-list" class="notification-scroll/);
  assert.match(css,/#notification-panel #notification-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css,/body\.notifications-open\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(app,/list\.scrollTo\(\{top:/);
  assert.match(app,/notification-footer/);
  assert.match(app,/Intl\.DateTimeFormat\('fr-FR'/);
});
