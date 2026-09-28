import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('playurl', {
  config: () => ipcRenderer.invoke('app:config'),
  copy: (value: string) => ipcRenderer.invoke('app:copy', value),
  login: (provider: string) => ipcRenderer.invoke('app:login', provider)
})
