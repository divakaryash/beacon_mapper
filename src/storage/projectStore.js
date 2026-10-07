const DATABASE = "inps";
const STORE = "projects";
const CURRENT_PROJECT = "current";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    let result;
    request.onsuccess = () => { result=request.result; };
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error||request.error||new Error("Local storage transaction failed")); };
  });
}

export function loadProject() {
  return transact("readonly", (store) => store.get(CURRENT_PROJECT));
}

export function saveProject(project) {
  return transact("readwrite", (store) => store.put(project, CURRENT_PROJECT));
}

export function clearProject() {
  return transact("readwrite", (store) => store.delete(CURRENT_PROJECT));
}
