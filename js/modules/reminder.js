// --- 提醒事项模块 ---

let reminderCalYear, reminderCalMonth, reminderSelectedDate;
let reminderCurrentTab = 'char'; // 'char' 或 'user'
let reminderCheckInterval = null;

function setupReminderModule() {
    const btn = document.getElementById('reminder-btn');
    if (btn) btn.addEventListener('click', openReminderScreen);

    // 日历导航
    const prevBtn = document.getElementById('reminder-cal-prev');
    const nextBtn = document.getElementById('reminder-cal-next');
    if (prevBtn) prevBtn.addEventListener('click', () => { reminderCalMonth--; if (reminderCalMonth < 0) { reminderCalMonth = 11; reminderCalYear--; } renderReminderCalendar(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { reminderCalMonth++; if (reminderCalMonth > 11) { reminderCalMonth = 0; reminderCalYear++; } renderReminderCalendar(); });

    // Tabs 分类切换
    document.querySelectorAll('.reminder-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabsContainer = document.getElementById('reminder-tabs');
            
            document.querySelectorAll('.reminder-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            reminderCurrentTab = tab.dataset.tab;
            
            // 触发滑块动画
            if (reminderCurrentTab === 'user') {
                tabsContainer.classList.add('tab-user-active');
            } else {
                tabsContainer.classList.remove('tab-user-active');
            }
            
            renderReminderList();
        });
    });

    // 年月快速选择器
    const monthPicker = document.getElementById('reminder-month-picker');
    if (monthPicker) {
        monthPicker.addEventListener('change', (e) => {
            if (e.target.value) { // 格式如 "2026-03"
                const parts = e.target.value.split('-');
                reminderCalYear = parseInt(parts[0], 10);
                reminderCalMonth = parseInt(parts[1], 10) - 1; // JS月份是 0-11
                
                // 选择后重置选中的日期为该月1号
                reminderSelectedDate = formatDateStr(new Date(reminderCalYear, reminderCalMonth, 1));
                
                renderReminderCalendar();
                renderReminderList();
            }
        });
    }

    // 新建按钮
    const addBtn = document.getElementById('reminder-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => openReminderForm());

    // 表单
    const cancelBtn = document.getElementById('reminder-form-cancel');
    const saveBtn = document.getElementById('reminder-form-save');
    if (cancelBtn) cancelBtn.addEventListener('click', closeReminderForm);
    if (saveBtn) saveBtn.addEventListener('click', saveReminderForm);

    // 类型选择器
    document.querySelectorAll('.reminder-type-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.reminder-type-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
        });
    });

    // 模态框背景点击关闭
    const modal = document.getElementById('reminder-form-modal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeReminderForm(); });

    // 启动全局定时检查
    startReminderChecker();
}

function openReminderScreen() {
    const now = new Date();
    reminderCalYear = now.getFullYear();
    reminderCalMonth = now.getMonth();
    reminderSelectedDate = formatDateStr(now);
    renderReminderCalendar();
    renderReminderList();
    switchScreen('reminder-screen');
}

function getCharReminders() {
    if (currentChatType !== 'private') return [];
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char) return [];
    if (!char.reminders) char.reminders = [];
    return char.reminders;
}

function formatDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function renderReminderCalendar() {
    const titleEl = document.getElementById('reminder-month-title');
    const daysEl = document.getElementById('reminder-calendar-days');
    const monthPicker = document.getElementById('reminder-month-picker');
    if (!titleEl || !daysEl) return;

    titleEl.textContent = `${reminderCalYear}年${reminderCalMonth + 1}月`;
    
    if (monthPicker) {
        const mStr = String(reminderCalMonth + 1).padStart(2, '0');
        monthPicker.value = `${reminderCalYear}-${mStr}`;
    }

    const reminders = getCharReminders();
    // 统计每天有哪些类型的提醒
    const dateMap = {};
    reminders.forEach(r => {
        if (!dateMap[r.date]) dateMap[r.date] = new Set();
        if (r.type === 'toUser') dateMap[r.date].add('user');
        else if (r.type === 'toSelf') dateMap[r.date].add('self');
        else if (r.type === 'remindChar') dateMap[r.date].add('char');
    });

    const firstDay = new Date(reminderCalYear, reminderCalMonth, 1);
    const lastDay = new Date(reminderCalYear, reminderCalMonth + 1, 0);

    const todayStr = formatDateStr(new Date());
    let html = '';

    // 当月 (横向滑动只渲染当月即可)
    for (let d = 1; d <= lastDay.getDate(); d++) {
        const dateStr = formatDateStr(new Date(reminderCalYear, reminderCalMonth, d));
        html += buildDayCell(d, dateStr, '', todayStr, dateMap);
    }

    daysEl.innerHTML = html;

    // 绑定点击
    daysEl.querySelectorAll('.calendar-day').forEach(el => {
        el.addEventListener('click', () => {
            reminderSelectedDate = el.dataset.date;
            renderReminderCalendar();
            renderReminderList();
        });
    });
    
    // 如果选中的日期在当前视图中，滚动到它
    const selectedEl = daysEl.querySelector('.calendar-day.selected');
    if (selectedEl) {
        // 使用 setTimeout 确保 DOM 渲染完成
        setTimeout(() => {
            selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }, 10);
    }
}

function buildDayCell(dayNum, dateStr, extraClass, todayStr, dateMap) {
    let cls = 'calendar-day ' + extraClass;
    if (dateStr === todayStr) cls += ' today';
    if (dateStr === reminderSelectedDate) cls += ' selected';

    // 移除点标记显示,用户会自己点击查看
    return `<div class="${cls}" data-date="${dateStr}">${dayNum}</div>`;
}

function renderReminderList() {
    const area = document.getElementById('reminder-list-area');
    if (!area) return;

    const reminders = getCharReminders();
    let dayReminders = reminders.filter(r => r.date === reminderSelectedDate)
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    // 根据当前 Tab 过滤
    if (reminderCurrentTab === 'char') {
        dayReminders = dayReminders.filter(r => r.type === 'remindChar' || r.type === 'toSelf');
    } else {
        dayReminders = dayReminders.filter(r => r.type === 'toUser');
    }

    if (dayReminders.length === 0) {
        const dateObj = new Date(reminderSelectedDate + 'T00:00:00');
        const label = dateObj.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
        area.innerHTML = `<div class="reminder-date-label">${label}</div><div class="reminder-empty">这一天暂无提醒事项</div>`;
        return;
    }

    const dateObj = new Date(reminderSelectedDate + 'T00:00:00');
    const label = dateObj.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    let html = `<div class="reminder-date-label">${label}</div>`;

    dayReminders.forEach(r => {
        const doneClass = r.done ? ' done' : '';
        const typeLabel = r.type === 'toUser' ? '提醒我' : r.type === 'toSelf' ? 'TA的待办' : '提醒TA';
        const typeClass = 'type-' + (r.type === 'toUser' ? 'user' : r.type === 'toSelf' ? 'self' : 'char');
        const tagClass = 'tag-' + r.type;
        
        // 获取当前角色信息
        const char = db.characters.find(c => c.id === currentChatId);
        const charRealName = char ? char.realName || char.name : '角色';
        const creatorLabel = r.createdBy === 'char' ? `${charRealName}创建` : '我创建';
        
        const repeatLabels = { none: '', daily: '每天', weekly: '每周', monthly: '每月' };
        const repeatTag = r.repeat && r.repeat !== 'none' ? `<span class="reminder-repeat-tag">${repeatLabels[r.repeat]}</span>` : '';

        html += `<div class="reminder-item ${typeClass}${doneClass}" data-id="${r.id}">
            <div class="reminder-check" data-id="${r.id}"></div>
            <div class="reminder-info">
                <div class="reminder-title">${escapeHtml(r.title)}</div>
                <div class="reminder-meta">
                    ${r.time ? `<span class="reminder-time-tag">${r.time}</span>` : ''}
                    <span class="reminder-type-tag ${tagClass}">${typeLabel}</span>
                    <span class="reminder-creator-tag">${creatorLabel}</span>
                    ${repeatTag}
                </div>
            </div>
            <button class="reminder-delete-btn" data-id="${r.id}">
                <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
        </div>`;
    });

    area.innerHTML = html;

    // 绑定完成切换
    area.querySelectorAll('.reminder-check').forEach(el => {
        el.addEventListener('click', () => {
            toggleReminderDone(el.dataset.id);
        });
    });

    // 绑定删除
    area.querySelectorAll('.reminder-delete-btn').forEach(el => {
        el.addEventListener('click', () => {
            deleteReminder(el.dataset.id);
        });
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function toggleReminderDone(id) {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char || !char.reminders) return;
    const r = char.reminders.find(rem => rem.id === id);
    if (r) {
        r.done = !r.done;
        saveData();
        renderReminderList();
        renderReminderCalendar();
    }
}

function deleteReminder(id) {
    const char = db.characters.find(c => c.id === currentChatId);
    if (!char || !char.reminders) return;
    char.reminders = char.reminders.filter(r => r.id !== id);
    saveData();
    renderReminderList();
    renderReminderCalendar();
}

function openReminderForm(editId) {
    const modal = document.getElementById('reminder-form-modal');
    const titleEl = document.getElementById('reminder-form-title');
    const inputTitle = document.getElementById('reminder-input-title');
    const inputDate = document.getElementById('reminder-input-date');
    const inputTime = document.getElementById('reminder-input-time');
    const inputRepeat = document.getElementById('reminder-input-repeat');

    if (editId) {
        titleEl.textContent = '编辑提醒';
        const char = db.characters.find(c => c.id === currentChatId);
        const r = char && char.reminders ? char.reminders.find(rem => rem.id === editId) : null;
        if (r) {
            inputTitle.value = r.title;
            inputDate.value = r.date;
            inputTime.value = r.time || '';
            inputRepeat.value = r.repeat || 'none';
            document.querySelectorAll('.reminder-type-option').forEach(o => {
                o.classList.toggle('active', o.dataset.type === r.type);
            });
        }
        modal.dataset.editId = editId;
    } else {
        titleEl.textContent = '新建提醒';
        inputTitle.value = '';
        inputDate.value = reminderSelectedDate || formatDateStr(new Date());
        inputTime.value = '';
        inputRepeat.value = 'none';
        document.querySelectorAll('.reminder-type-option').forEach(o => {
            o.classList.toggle('active', o.dataset.type === 'toUser');
        });
        delete modal.dataset.editId;
    }

    modal.classList.add('visible');
    setTimeout(() => inputTitle.focus(), 100);
}

function closeReminderForm() {
    const modal = document.getElementById('reminder-form-modal');
    modal.classList.remove('visible');
}

function saveReminderForm() {
    const modal = document.getElementById('reminder-form-modal');
    const title = document.getElementById('reminder-input-title').value.trim();
    const date = document.getElementById('reminder-input-date').value;
    const time = document.getElementById('reminder-input-time').value;
    const repeat = document.getElementById('reminder-input-repeat').value;
    const typeEl = document.querySelector('.reminder-type-option.active');
    const type = typeEl ? typeEl.dataset.type : 'toUser';

    if (!title) { showToast('请输入提醒内容'); return; }
    if (!date) { showToast('请选择日期'); return; }

    const char = db.characters.find(c => c.id === currentChatId);
    if (!char) return;
    if (!char.reminders) char.reminders = [];

    const editId = modal.dataset.editId;
    if (editId) {
        const r = char.reminders.find(rem => rem.id === editId);
        if (r) {
            r.title = title;
            r.date = date;
            r.time = time;
            r.repeat = repeat;
            r.type = type;
        }
    } else {
        char.reminders.push({
            id: 'rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            title: title,
            date: date,
            time: time || '',
            repeat: repeat,
            type: type,
            createdBy: 'user',
            done: false,
            triggered: false,
            createdAt: Date.now()
        });
    }

    saveData();
    closeReminderForm();
    renderReminderCalendar();
    renderReminderList();
    showToast('提醒已保存');
}

// --- 全局提醒检查器 ---
function startReminderChecker() {
    if (reminderCheckInterval) clearInterval(reminderCheckInterval);
    reminderCheckInterval = setInterval(checkReminders, 30000); // 每30秒检查
    // 启动时也检查一次
    setTimeout(checkReminders, 3000);
}

function checkReminders() {
    if (!db || !db.characters) return;
    const now = new Date();
    const todayStr = formatDateStr(now);
    const nowTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    db.characters.forEach(char => {
        if (!char.reminders || char.reminders.length === 0) return;

        char.reminders.forEach(r => {
            if (r.done || r.triggered) return;
            if (r.date !== todayStr) return;
            if (!r.time) return;
            if (r.time > nowTime) return;

            // 时间已到，触发提醒
            r.triggered = true;
            triggerReminder(char, r);

            // 处理重复
            if (r.repeat && r.repeat !== 'none') {
                const nextDate = getNextRepeatDate(r.date, r.repeat);
                char.reminders.push({
                    id: 'rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    title: r.title,
                    date: nextDate,
                    time: r.time,
                    repeat: r.repeat,
                    type: r.type,
                    createdBy: r.createdBy,
                    done: false,
                    triggered: false,
                    createdAt: Date.now()
                });
            }
        });
    });
    saveData();
}

function getNextRepeatDate(dateStr, repeat) {
    const d = new Date(dateStr + 'T00:00:00');
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    return formatDateStr(d);
}

function triggerReminder(char, reminder) {
    const typeLabels = { toUser: '提醒你', toSelf: '的待办到期', remindChar: '被提醒' };

    // Toast 通知
    if (reminder.type === 'toUser' || reminder.type === 'toSelf') {
        showToast({
            name: char.remarkName || char.name || char.realName,
            avatar: char.avatar,
            message: reminder.type === 'toUser'
                ? `提醒你：${reminder.title}`
                : `待办到期：${reminder.title}`
        });
    }

    // 聊天内系统消息
    if (char.showReminderMsg !== false) {
        let msgContent = '';
        if (reminder.type === 'toUser') {
            msgContent = `[${char.realName}提醒你：${reminder.title}]`;
        } else if (reminder.type === 'toSelf') {
            msgContent = `[${char.realName}的待办到期：${reminder.title}]`;
        } else if (reminder.type === 'remindChar') {
            msgContent = `[你提醒${char.realName}：${reminder.title}]`;
        }

        if (msgContent) {
            const message = {
                id: `msg_${Date.now()}_${Math.random()}`,
                role: reminder.type === 'remindChar' ? 'user' : 'assistant',
                content: msgContent,
                timestamp: Date.now(),
                isReminderMsg: true
            };
            char.history.push(message);

            // 如果当前在这个聊天界面，渲染消息
            if (currentChatType === 'private' && currentChatId === char.id) {
                addMessageBubble(message, char.id, 'private');
            }
        }
    }

    // 如果是提醒TA类型，触发角色回复
    if (reminder.type === 'remindChar' && currentChatType === 'private' && currentChatId === char.id) {
        setTimeout(() => {
            getAiReply(char.id, 'private', true);
        }, 1500);
    }

    // 如果是提醒用户类型且角色有提醒功能，触发角色用自己语气发消息
    if (reminder.type === 'toUser' && char.charReminderEnabled) {
        if (currentChatType === 'private' && currentChatId === char.id) {
            setTimeout(() => {
                getAiReply(char.id, 'private', true);
            }, 2000);
        }
    }

    // 更新聊天列表
    if (typeof renderChatList === 'function') renderChatList();
}

// --- AI 标签解析：从角色回复中提取提醒指令 ---
function parseReminderTags(content, charId) {
    const char = db.characters.find(c => c.id === charId);
    if (!char || !char.charReminderEnabled) return content;
    if (!char.reminders) char.reminders = [];

    let cleaned = content;

    // [创建提醒：日期 时间|内容] 或 [创建提醒：时间|内容]（默认今天）
    const reminderRegex = /\[创建提醒[：:]\s*([^\]|]+?)\|([^\]]+?)\]/g;
    let match;
    while ((match = reminderRegex.exec(content)) !== null) {
        const parsed = parseReminderDateTime(match[1].trim());
        const title = match[2].trim();
        if (title) {
            char.reminders.push({
                id: 'rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                title: title,
                date: parsed.date,
                time: parsed.time,
                repeat: 'none',
                type: 'toUser',
                createdBy: 'char',
                done: false,
                triggered: false,
                createdAt: Date.now()
            });

            // 插入系统消息
            if (char.showReminderMsg !== false) {
                const sysMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: `[${char.realName}创建了提醒：${parsed.time ? parsed.time + ' ' : ''}${title}]`,
                    timestamp: Date.now(),
                    isReminderMsg: true
                };
                char.history.push(sysMsg);
                if (currentChatType === 'private' && currentChatId === char.id) {
                    addMessageBubble(sysMsg, char.id, 'private');
                }
            }
        }
        cleaned = cleaned.replace(match[0], '');
    }

    // [创建待办：日期 时间|内容]
    const todoRegex = /\[创建待办[：:]\s*([^\]|]+?)\|([^\]]+?)\]/g;
    while ((match = todoRegex.exec(content)) !== null) {
        const parsed = parseReminderDateTime(match[1].trim());
        const title = match[2].trim();
        if (title) {
            char.reminders.push({
                id: 'rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                title: title,
                date: parsed.date,
                time: parsed.time,
                repeat: 'none',
                type: 'toSelf',
                createdBy: 'char',
                done: false,
                triggered: false,
                createdAt: Date.now()
            });

            if (char.showReminderMsg !== false) {
                const sysMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: `[${char.realName}添加了待办：${parsed.time ? parsed.time + ' ' : ''}${title}]`,
                    timestamp: Date.now(),
                    isReminderMsg: true
                };
                char.history.push(sysMsg);
                if (currentChatType === 'private' && currentChatId === char.id) {
                    addMessageBubble(sysMsg, char.id, 'private');
                }
            }
        }
        cleaned = cleaned.replace(match[0], '');
    }

    // [完成待办：内容关键词]
    const doneRegex = /\[完成待办[：:]\s*([^\]]+?)\]/g;
    while ((match = doneRegex.exec(content)) !== null) {
        const keyword = match[1].trim();
        const target = char.reminders.find(r => !r.done && r.type === 'toSelf' && r.title.includes(keyword));
        if (target) {
            target.done = true;
            if (char.showReminderMsg !== false) {
                const sysMsg = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: `[${char.realName}完成了待办：${target.title}]`,
                    timestamp: Date.now(),
                    isReminderMsg: true
                };
                char.history.push(sysMsg);
                if (currentChatType === 'private' && currentChatId === char.id) {
                    addMessageBubble(sysMsg, char.id, 'private');
                }
            }
        }
        cleaned = cleaned.replace(match[0], '');
    }

    if (cleaned !== content) saveData();
    return cleaned.replace(/\n\s*\n/g, '\n').trim();
}

function parseReminderDateTime(str) {
    const now = new Date();
    let date = formatDateStr(now);
    let time = '';

    // 匹配 "今天 14:00" / "明天 10:00" / "2026-03-09 14:00" / "14:00"
    const fullDateMatch = str.match(/(\d{4}-\d{2}-\d{2})\s*(\d{1,2}:\d{2})?/);
    const relativeMatch = str.match(/(今天|明天|后天)\s*(\d{1,2}:\d{2})?/);
    const timeOnlyMatch = str.match(/^(\d{1,2}:\d{2})$/);

    if (fullDateMatch) {
        date = fullDateMatch[1];
        time = fullDateMatch[2] || '';
    } else if (relativeMatch) {
        const d = new Date();
        if (relativeMatch[1] === '明天') d.setDate(d.getDate() + 1);
        else if (relativeMatch[1] === '后天') d.setDate(d.getDate() + 2);
        date = formatDateStr(d);
        time = relativeMatch[2] || '';
    } else if (timeOnlyMatch) {
        time = timeOnlyMatch[1];
    }

    // 补齐时间格式
    if (time && time.length === 4) time = '0' + time; // "9:00" -> "09:00"

    return { date, time };
}

// --- 系统提示词注入 ---
function generateReminderPrompt(character) {
    if (!character.charReminderEnabled) return '';

    const reminders = (character.reminders || []).filter(r => !r.done);
    const now = new Date();
    const todayStr = formatDateStr(now);

    let prompt = '\n<reminders>\n';
    prompt += '【提醒事项】你拥有提醒事项/待办功能。你可以：\n';
    prompt += '1. 为用户创建提醒：[创建提醒：日期 时间|内容]（如 [创建提醒：今天 14:00|该上课了]）\n';
    prompt += '2. 为自己创建待办：[创建待办：日期 时间|内容]（如 [创建待办：明天 10:00|给用户准备惊喜]）\n';
    prompt += '3. 完成自己的待办：[完成待办：待办内容关键词]\n';
    prompt += '日期支持：今天、明天、后天、或 YYYY-MM-DD 格式。\n';
    prompt += '请在合适时机自然地使用，不要刻意。当用户提到需要在某个时间做某事时，可以主动创建提醒。你也可以给自己安排待办事项。\n\n';

    if (reminders.length > 0) {
        prompt += '当前未完成的提醒/待办：\n';
        reminders.forEach(r => {
            const typeLabel = r.type === 'toUser' ? '提醒用户' : r.type === 'toSelf' ? '自己的待办' : '用户提醒你';
            prompt += `- [${r.date} ${r.time || '全天'}] ${r.title}（${typeLabel}）\n`;
        });
    } else {
        prompt += '当前没有未完成的提醒或待办。\n';
    }

    prompt += '</reminders>\n\n';
    return prompt;
}
