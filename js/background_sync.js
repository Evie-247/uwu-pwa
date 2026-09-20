/* UwU Background Sync + Web Push bridge */
(() => {
  const cfg = () => window.UWU_BACKGROUND_CONFIG || {};
  const cleanUrl = () => String(cfg().BACKEND_URL || '').replace(/\/$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', 'X-UwU-Token': cfg().CLIENT_TOKEN || '' });
  const enabled = () => !!cfg().enabled && /^https:\/\//.test(cleanUrl()) && cfg().CLIENT_TOKEN && cfg().CLIENT_TOKEN !== 'CHANGE-ME';

  function b64ToUint8Array(base64) {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  function safeHistory(char) {
    const max = Math.min(Number(char.maxMemory || 100), 120);
    return (char.history || []).slice(-max).filter(m => !m.isThinking && !m.isContextDisabled).map(m => ({
      id: m.id, role: m.role, content: m.content, parts: m.parts, timestamp: m.timestamp
    }));
  }

  function makeSnapshot(char) {
    return {
      id: char.id,
      realName: char.realName || char.remarkName || 'Character',
      remarkName: char.remarkName || char.realName || 'Character',
      avatar: char.avatar || '',
      persona: char.persona || '',
      myName: char.myName || 'user',
      myPersona: char.myPersona || '',
      autoReply: char.autoReply || { enabled: false },
      isBlocked: !!char.isBlocked,
      maxMemory: char.maxMemory || 100,
      history: safeHistory(char),
      syncedAt: Date.now()
    };
  }

  async function api(path, options = {}) {
    if (!enabled()) return null;
    const res = await fetch(cleanUrl() + path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    if (!res.ok) throw new Error(`UwU backend ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  async function syncCharacter(char) {
    if (!enabled() || !char || !char.id) return;
    try {
      await api('/api/characters/sync', { method: 'POST', body: JSON.stringify(makeSnapshot(char)) });
    } catch (e) { console.warn('[UwU Background] character sync failed:', e); }
  }

  async function syncAll() {
    if (!enabled() || !window.db?.characters) return;
    await Promise.allSettled(db.characters.map(syncCharacter));
  }

  async function subscribePush() {
    if (!enabled() || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      const conf = await api('/api/config');
      if (!conf?.vapidPublicKey) return;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8Array(conf.vapidPublicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    } catch (e) { console.warn('[UwU Background] push subscribe failed:', e); }
  }

  async function pullMessages() {
    if (!enabled() || !window.db?.characters) return;
    try {
      const data = await api('/api/messages/pending');
      const rows = data?.messages || [];
      const ack = [];
      for (const row of rows) {
        const char = db.characters.find(c => c.id === row.characterId);
        if (!char) continue;
        char.history ||= [];
        if (!char.history.some(m => m.id === row.message.id)) {
          char.history.push(row.message);
          char.unreadCount = (char.unreadCount || 0) + 1;
          if (typeof saveCharacter === 'function') await saveCharacter(char.id);
        }
        ack.push(row.id);
      }
      if (ack.length) await api('/api/messages/ack', { method: 'POST', body: JSON.stringify({ ids: ack }) });
    } catch (e) { console.warn('[UwU Background] pending-message pull failed:', e); }
  }

  async function init() {
    if (!enabled()) return;
    await subscribePush();
    await pullMessages();
    await syncAll();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullMessages(); });
  }

  window.UwUBackgroundSync = { init, syncCharacter, syncAll, subscribePush, pullMessages, enabled };
})();
