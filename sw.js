// Service Worker - 支持系统推送通知
self.addEventListener('install', (event) => {
    console.log('Service worker installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // 不拦截请求
    return;
});

// 接收来自页面的消息，直接显示系统通知（无需服务器，应用在前/后台时使用）
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, icon, badge, tag } = event.data.payload;
        event.waitUntil(
            self.registration.showNotification(title, {
                body: body || '',
                icon: icon || undefined,
                badge: badge || undefined,
                tag: tag || 'ovo-message',
                renotify: true,
                vibrate: [200, 100, 200],
            })
        );
    }
});

// 接收服务器 Web Push（用户配置了自定义推送服务器时由服务器推送过来）
self.addEventListener('push', (event) => {
    if (!event.data) return;
    let data = {};
    try {
        data = event.data.json();
    } catch (e) {
        data = { title: 'OVO', body: event.data.text() };
    }
    event.waitUntil(
        self.registration.showNotification(data.title || 'OVO', {
            body: data.body || '',
            icon: data.icon || undefined,
            badge: data.badge || undefined,
            tag: data.messageId || 'ovo-push',
            data: { url: data.url || './', characterId: data.characterId || null },
            renotify: true,
            vibrate: [200, 100, 200],
        })
    );
});

// 点击通知后将应用窗口聚焦到前台
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(event.notification.data?.url || './');
        })
    );
});
