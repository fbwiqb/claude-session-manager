const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  list: (o) => ipcRenderer.invoke("list", o),
  transcript: (sid) => ipcRenderer.invoke("transcript", sid),
  favorite: (sid) => ipcRenderer.invoke("favorite", sid),
  favoriteMove: (sid, dir) => ipcRenderer.invoke("favorite-move", { sid, dir }),
  rename: (sid, title) => ipcRenderer.invoke("rename", { sid, title }),
  remove: (sid) => ipcRenderer.invoke("delete", sid),
  deleteMany: (sids) => ipcRenderer.invoke("delete-many", sids),
  restore: (sid) => ipcRenderer.invoke("restore", sid),
  cleanupDelete: () => ipcRenderer.invoke("cleanup-delete"),
  open: (sid) => ipcRenderer.invoke("open", sid),
  openApp: (sid) => ipcRenderer.invoke("open-app", sid),
  trash: () => ipcRenderer.invoke("trash"),
  refresh: () => ipcRenderer.invoke("refresh"),
  onSearchProgress: (cb) => ipcRenderer.on("search-progress", (e, d) => cb(d)),
});
