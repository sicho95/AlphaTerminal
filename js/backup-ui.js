import { BackupVault } from './backup.js';

export function initSettingsTabs(){
  const tabs=[...document.querySelectorAll('.settings-tabbar [data-tab]')];
  const panes=[...document.querySelectorAll('.settings-pane')];
  const show=id=>{
    for(const tab of tabs){
      const active=tab.dataset.tab===id;
      tab.setAttribute('aria-selected',String(active));
      tab.tabIndex=active?0:-1;
    }
    for(const pane of panes)pane.classList.toggle('hidden',pane.dataset.settingsTab!==id);
    sessionStorage.setItem('alphaterminal-settings-tab',id);
  };
  for(const tab of tabs)tab.addEventListener('click',()=>show(tab.dataset.tab));
  show(tabs.some(t=>t.dataset.tab===sessionStorage.getItem('alphaterminal-settings-tab'))?
    sessionStorage.getItem('alphaterminal-settings-tab'):'general');
}
export async function initBackupUI(){
  const el=id=>document.getElementById(id);
  const status=el('backupStatus');
  const show=text=>{status.textContent=text;};
  const refresh=async()=>el('backupKeyStatus').textContent=await BackupVault.hasKey()?
    'Disponible sur cet appareil · mot de passe non conservé':'Aucune clé définie pour cet appareil';
  await refresh();
  el('backupSetPassword').onclick=async()=>{
    const password=el('backupNewPassword').value;
    try{
      if(await BackupVault.setPassword(password)){
        el('backupNewPassword').value='';
        await refresh();
        show('Clé de sauvegarde enregistrée uniquement sur cet appareil. Enregistrer la phrase de passe dans votre gestionnaire si souhaité.');
      }
    }catch(e){show('Erreur : '+e.message);}
  };
  el('backupExport').onclick=async()=>{
    try{await BackupVault.export();show('Sauvegarde chiffrée téléchargée. Conserver le fichier dans un endroit sûr.');}
    catch(e){show('Erreur : '+e.message);}
  };
  el('backupRestore').onclick=async()=>{
    const file=el('backupFile').files?.[0];
    if(!file){show('Sélectionner d’abord un fichier JSON.');return;}
    const password=el('backupRestorePassword').value;
    try{
      const result=await BackupVault.restore(file,password);
      if(result==='cancelled'){show('Restauration annulée.');return;}
      el('backupRestorePassword').value='';
      await refresh();
      show(result==='restored-with-nas'?
        'Restauration terminée. Même profil NAS reconnecté, appareil indépendant. Vérifier les portefeuilles et les alertes.':
        result==='restored-local-nas-unavailable'?
        'Données locales restaurées. Le profil NAS n’a pas pu être récupéré ; vérifier sa disponibilité avant d’activer une nouvelle synchronisation.':
        'Restauration locale complète. Aucune nouvelle synchronisation NAS créée.');
    }catch(e){
      show(e.message==='PASSWORD_REQUIRED'?
        'Mot de passe nécessaire ou incorrect. Saisissez celui du fichier chiffré puis cliquez de nouveau sur Restaurer.':
        'Restauration non terminée : '+e.message);
    }
  };
}