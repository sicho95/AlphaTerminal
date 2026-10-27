/** Onglets en intercalaires accessibles, communs à Signaux, Analyse, Inventaire et Paramètres. */
export function initSectionTabs(root, storageKey = '') {
  if (!root) return () => {};
  const tabs=[...root.querySelectorAll(':scope > .section-tabbar [role="tab"]')];
  const panels=[...root.querySelectorAll(':scope > .section-tabframe > [data-tab-panel]')];
  if (!tabs.length || tabs.length!==panels.length) throw Error('Onglets incomplets : un panneau par onglet est requis');
  const names=tabs.map(tab=>tab.dataset.tab);
  const key=storageKey?'alphaTerm_tabs_'+storageKey:'';
  let selected=''; 
  const choose=(name,{focus=false,persist=true}={})=>{
    if (!names.includes(name))return;
    selected=name;
    for (const [i,tab] of tabs.entries()){
      const active=tab.dataset.tab===name;
      tab.setAttribute('aria-selected',String(active));
      tab.setAttribute('aria-controls',panels[i].id);
      tab.tabIndex=active?0:-1;
      panels[i].hidden=!active;
      panels[i].classList.toggle('hidden',!active);
      panels[i].setAttribute('aria-labelledby',tab.id);
      if(active&&focus){tab.focus({preventScroll:true});tab.scrollIntoView({block:'nearest',inline:'nearest'});}
    }
    if(key&&persist){try{sessionStorage.setItem(key,name);}catch{/* navigation remains available */}}
    if(persist&&typeof root.dispatchEvent==='function')root.dispatchEvent(
      new CustomEvent('alphaterminal:tabchange',{detail:{tab:name}}));
  };
  const remembered=(()=>{try{return key?sessionStorage.getItem(key):null;}catch{return null;}})();
  choose(names.includes(remembered)?remembered:names[0],{persist:false});
  const listeners=[];
  tabs.forEach((tab,index)=>{
    const click=()=>choose(tab.dataset.tab);
    const keydown=event=>{
      const current=names.indexOf(selected);
      let next=current;
      if(event.key==='ArrowRight')next=(current+1)%tabs.length;
      else if(event.key==='ArrowLeft')next=(current-1+tabs.length)%tabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=tabs.length-1;
      else return;
      event.preventDefault();
      choose(names[next],{focus:true});
    };
    tab.addEventListener('click',click);
    tab.addEventListener('keydown',keydown);
    listeners.push([tab,click,keydown]);
  });
  return ()=>listeners.forEach(([tab,click,keydown])=>{
    tab.removeEventListener('click',click);
    tab.removeEventListener('keydown',keydown);
  });
}
