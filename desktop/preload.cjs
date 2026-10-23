const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  request:(type,payload) => ipcRenderer.invoke('document',type,payload),
  onCommand:callback => ipcRenderer.on('command',(_event,command) => callback(command)),
  onAssociationError:callback => ipcRenderer.on('association-error',(_event,error)=>callback(error)),
  onLibraryChanged:callback => ipcRenderer.on('library-changed',()=>callback()),
  onLibraryError:callback => ipcRenderer.on('library-error',(_event,error)=>callback(error)),
  sessionReport:payload => ipcRenderer.send('session-report',payload),
  closeReady:() => ipcRenderer.send('close-ready'),
});
