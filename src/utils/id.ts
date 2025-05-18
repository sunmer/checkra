const KEY = 'checkraSiteId';

export function getSiteId(): string {
  let id = localStorage.getItem(KEY) || localStorage.getItem('CheckraAnonymousId');
  if (!id) {
    id = crypto.randomUUID().slice(0, 8);      // MVP length-8 ID
    localStorage.setItem(KEY, id);
  }
  return id;
} 