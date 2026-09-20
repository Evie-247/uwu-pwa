// --- 世界书功能 (js/modules/worldbook.js) ---
let pendingWbCategoryDelete = null; // 删除分类弹窗用：{ category, count }

function enterWorldBookMultiSelectMode(initialId, initialCategory = null) {
    if (isWorldBookMultiSelectMode) return;
    isWorldBookMultiSelectMode = true;

    document.getElementById('add-world-book-btn').style.display = 'none';
    const importBtn = document.getElementById('import-world-book-btn');
    if (importBtn) importBtn.style.display = 'none';
    document.getElementById('cancel-wb-multi-select-btn').style.display = 'inline-block';
    document.getElementById('world-book-multi-select-bar').style.display = 'flex';
    document.querySelector('#world-book-screen .content').style.paddingBottom = '70px';

    selectedWorldBookIds.clear();
    if (initialId) {
        selectedWorldBookIds.add(initialId);
    }

    updateWorldBookSelectCount();
    renderWorldBookList(initialCategory); 
}

function exitWorldBookMultiSelectMode() {
    isWorldBookMultiSelectMode = false;

    document.getElementById('add-world-book-btn').style.display = 'inline-block';
    const importBtn = document.getElementById('import-world-book-btn');
    if (importBtn) importBtn.style.display = 'inline-block';
    document.getElementById('cancel-wb-multi-select-btn').style.display = 'none';
    document.getElementById('world-book-multi-select-bar').style.display = 'none';
    document.querySelector('#world-book-screen .content').style.paddingBottom = '0';

    selectedWorldBookIds.clear();
    renderWorldBookList();
}

function toggleWorldBookSelection(bookId) {
    const itemEl = document.getElementById('world-book-list-container').querySelector(`.world-book-item[data-id="${bookId}"]`);
    if (selectedWorldBookIds.has(bookId)) {
        selectedWorldBookIds.delete(bookId);
        if(itemEl) itemEl.classList.remove('selected');
    } else {
        selectedWorldBookIds.add(bookId);
        if(itemEl) itemEl.classList.add('selected');
    }
    updateWorldBookSelectCount();
}

function updateWorldBookSelectCount() {
    const count = selectedWorldBookIds.size;
    document.getElementById('world-book-select-count').textContent = `已选择 ${count} 项`;
    const deleteBtn = document.getElementById('delete-selected-world-books-btn');
    const moveBtn = document.getElementById('move-selected-world-books-btn');
    const toggleBtn = document.getElementById('toggle-selected-world-books-btn');
    if (deleteBtn) deleteBtn.disabled = count === 0;
    if (moveBtn) moveBtn.disabled = count === 0;
    if (toggleBtn) toggleBtn.disabled = count === 0;

    // 根据选中项的状态更新按钮文字
    if (toggleBtn && count > 0) {
        const selectedBooks = db.worldBooks.filter(book => selectedWorldBookIds.has(book.id));
        const allDisabled = selectedBooks.length > 0 && selectedBooks.every(book => !!book.disabled);
        toggleBtn.textContent = allDisabled ? '启用已选' : '停用已选';
    }
}

/**
 * 从纯文本（TXT/DOCX 提取结果）解析为分类与条目：按双换行分段落，每段首行为条目名、其余为内容，归为「导入」分类
 */
function parseTextToWorldBookEntries(text, defaultCategory = '导入') {
    const entries = [];
    const raw = (text || '').trim();
    if (!raw) return entries;
    const category = defaultCategory;
    const lines = raw.split(/\n/);
    const name = lines[0].trim() || '未命名条目';
    entries.push({ name, content: raw, category });
    return entries;
}

/**
 * 从 JSON 解析为世界书条目，支持：character_book.entries、{ categories: [...] }、条目数组
 */
function parseJsonToWorldBookEntries(jsonText, defaultCategory = '导入') {
    const entries = [];
    let data;
    try {
        data = JSON.parse(jsonText);
    } catch (e) {
        throw new Error('JSON 格式无效');
    }
    if (!data || typeof data !== 'object') return entries;

    // SillyTavern/角色卡式：entries 为对象 { "0": { comment, content }, "1": ... }
    if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
        const category = defaultCategory;
        Object.values(data.entries).forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const name = (entry.comment || entry.name || entry.title || '未命名').trim();
            const content = (entry.content || entry.text || '').trim();
            if (name && content) entries.push({ name, content, category });
        });
        return entries;
    }
    if (data.character_book && Array.isArray(data.character_book.entries)) {
        const category = data.name || data.character_name || defaultCategory;
        data.character_book.entries.forEach(entry => {
            const name = entry.comment || entry.name || '未命名';
            const content = entry.content || '';
            if (name && content) entries.push({ name, content, category });
        });
        return entries;
    }
    if (Array.isArray(data.categories) && data.categories.length > 0) {
        data.categories.forEach(cat => {
            const category = (cat.name || cat.title || '未分类').trim() || '未分类';
            const list = cat.entries || cat.items || [];
            list.forEach(entry => {
                const name = (entry.name || entry.title || entry.comment || '未命名').trim();
                const content = (entry.content || entry.text || '').trim();
                if (name && content) entries.push({ name, content, category });
            });
        });
        return entries;
    }
    if (Array.isArray(data)) {
        data.forEach(item => {
            const name = (item.name || item.title || item.comment || '未命名').trim();
            const content = (item.content || item.text || '').trim();
            const category = (item.category || item.categoryName || defaultCategory).trim() || defaultCategory;
            if (name && content) entries.push({ name, content, category });
        });
        return entries;
    }
    return entries;
}

async function handleImportWorldBookFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let fileNameWithoutExt = file.name;
    const lastDotIndex = file.name.lastIndexOf('.');
    if (lastDotIndex > 0) {
        fileNameWithoutExt = file.name.substring(0, lastDotIndex);
    }
    const defaultCategory = fileNameWithoutExt || '导入';
    let entries = [];
    let text = '';

    if (ext === 'txt') {
        text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result || '');
            reader.onerror = () => reject(new Error('读取 TXT 失败'));
            reader.readAsText(file, 'UTF-8');
        });
        entries = parseTextToWorldBookEntries(text, defaultCategory);
    } else if (ext === 'docx') {
        if (typeof parseDocxFile === 'undefined') {
            showToast('无法解析 DOCX，请刷新后重试');
            return;
        }
        text = await parseDocxFile(file);
        entries = parseTextToWorldBookEntries(text, defaultCategory);
    } else if (ext === 'json') {
        text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result || '');
            reader.onerror = () => reject(new Error('读取 JSON 失败'));
            reader.readAsText(file, 'UTF-8');
        });
        entries = parseJsonToWorldBookEntries(text, defaultCategory);
    } else {
        showToast('仅支持 .txt、.json、.docx 格式');
        return;
    }

    if (entries.length === 0) {
        showToast('未能解析出任何条目，请检查文件格式');
        return;
    }

    const toAdd = entries.map((e, i) => ({
        id: `wb_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
        name: e.name,
        content: e.content,
        category: e.category || defaultCategory,
        position: 'before',
        isGlobal: false,
        disabled: false
    }));

    db.worldBooks.push(...toAdd);
    await dexieDB.worldBooks.bulkPut(toAdd);
    await saveData();
    renderWorldBookList();
    showToast(`已导入 ${toAdd.length} 条世界书`);
}

async function deleteSelectedWorldBooks() {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;

    if (confirm(`确定要删除这 ${count} 个世界书条目吗？此操作不可恢复。`)) {
        const idsToDelete = Array.from(selectedWorldBookIds);
        
        await dexieDB.worldBooks.bulkDelete(idsToDelete);
        db.worldBooks = db.worldBooks.filter(book => !selectedWorldBookIds.has(book.id));
        
        db.characters.forEach(char => {
            if (char.worldBookIds) {
                char.worldBookIds = char.worldBookIds.filter(id => !selectedWorldBookIds.has(id));
            }
        });
        db.groups.forEach(group => {
            if (group.worldBookIds) {
                group.worldBookIds = group.worldBookIds.filter(id => !selectedWorldBookIds.has(id));
            }
        });

        await saveData();
        showToast(`已成功删除 ${count} 个条目`);
        exitWorldBookMultiSelectMode();
    }
}

function showMoveCategoryModal() {
    const count = selectedWorldBookIds.size;
    if (count === 0) {
        showToast('请先选择要移动的世界书条目');
        return;
    }

    const modal = document.getElementById('world-book-move-category-modal');
    const desc = document.getElementById('wb-move-category-modal-desc');
    const categoryList = document.getElementById('wb-move-category-list');
    
    if (!modal || !desc || !categoryList) return;

    desc.textContent = `将 ${count} 个条目移动到分类：`;
    categoryList.innerHTML = '';

    // 获取所有分类
    const categories = new Set();
    db.worldBooks.forEach(book => {
        const cat = (book.category && book.category.trim()) || '未分类';
        categories.add(cat);
    });

    // 排序：未分类优先，其余按名称排序
    const sortedCategories = Array.from(categories).sort((a, b) => {
        if (a === '未分类') return -1;
        if (b === '未分类') return 1;
        return a.localeCompare(b);
    });

    // 创建分类选项
    sortedCategories.forEach(category => {
        const option = document.createElement('div');
        option.className = 'wb-move-category-option';
        option.style.cssText = 'padding: 12px; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background-color 0.2s;';
        option.dataset.category = category;
        
        option.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-weight: 500; color: #333;">${category}</span>
                <span style="color: #999; font-size: 12px;">›</span>
            </div>
        `;

        option.addEventListener('click', () => {
            // 移除之前的选中状态
            categoryList.querySelectorAll('.wb-move-category-option').forEach(opt => {
                opt.style.backgroundColor = '';
                delete opt.dataset.selected;
            });
            // 设置当前选中
            option.style.backgroundColor = '#e8f5e9';
            option.dataset.selected = 'true';
        });

        option.addEventListener('mouseenter', () => {
            if (!option.dataset.selected) {
                option.style.backgroundColor = '#f5f5f5';
            }
        });

        option.addEventListener('mouseleave', () => {
            if (!option.dataset.selected) {
                option.style.backgroundColor = '';
            }
        });

        categoryList.appendChild(option);
    });

    // 添加"新建分类"选项
    const newCategoryOption = document.createElement('div');
    newCategoryOption.className = 'wb-move-category-option wb-move-category-new';
    newCategoryOption.style.cssText = 'padding: 12px; border-top: 2px solid #e0e0e0; cursor: pointer; transition: background-color 0.2s;';
    newCategoryOption.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-weight: 500; color: var(--primary-color);">+ 新建分类</span>
            <span style="color: #999; font-size: 12px;">›</span>
        </div>
    `;
    newCategoryOption.addEventListener('click', () => {
        const newCategoryName = prompt('输入新分类名称：', '');
        if (newCategoryName === null) return;
        const trimmed = newCategoryName.trim();
        if (!trimmed) {
            showToast('分类名不能为空');
            return;
        }
        // 直接移动到新分类
        moveSelectedWorldBooksToCategory(trimmed);
        modal.classList.remove('visible');
        // 清除选择状态
        categoryList.querySelectorAll('.wb-move-category-option').forEach(opt => {
            opt.style.backgroundColor = '';
            delete opt.dataset.selected;
        });
    });
    newCategoryOption.addEventListener('mouseenter', () => {
        newCategoryOption.style.backgroundColor = '#f5f5f5';
    });
    newCategoryOption.addEventListener('mouseleave', () => {
        newCategoryOption.style.backgroundColor = '';
    });
    categoryList.appendChild(newCategoryOption);

    modal.classList.add('visible');
}

async function moveSelectedWorldBooksToCategory(targetCategory) {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;

    const idsToMove = Array.from(selectedWorldBookIds);
    let movedCount = 0;

    idsToMove.forEach(bookId => {
        const book = db.worldBooks.find(wb => wb.id === bookId);
        if (book) {
            book.category = targetCategory || '';
            movedCount++;
        }
    });

    if (movedCount > 0) {
        // 批量更新数据库
        const booksToUpdate = db.worldBooks.filter(wb => idsToMove.includes(wb.id));
        await dexieDB.worldBooks.bulkPut(booksToUpdate);
        await saveData();
        
        showToast(`已成功将 ${movedCount} 个条目移动到「${targetCategory || '未分类'}」`);
        renderWorldBookList();
        exitWorldBookMultiSelectMode();
    }
}

async function toggleSelectedWorldBooks() {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;

    const selectedBooks = db.worldBooks.filter(book => selectedWorldBookIds.has(book.id));
    if (selectedBooks.length === 0) return;

    // 判断是否全部已停用
    const allDisabled = selectedBooks.every(book => !!book.disabled);
    const newDisabledState = !allDisabled;

    // 批量更新状态
    selectedBooks.forEach(book => {
        book.disabled = newDisabledState;
    });

    // 批量更新数据库
    await dexieDB.worldBooks.bulkPut(selectedBooks);
    await saveData();

    const actionText = newDisabledState ? '停用' : '启用';
    showToast(`已${actionText} ${selectedBooks.length} 个条目`);
    renderWorldBookList();
    updateWorldBookSelectCount();
}

let categorySortable = null;
let itemSortables = [];

function setupWorldBookApp() {
    const addWorldBookBtn = document.getElementById('add-world-book-btn');
    const editWorldBookForm = document.getElementById('edit-world-book-form');
    const worldBookNameInput = document.getElementById('world-book-name');
    const worldBookCategoryInput = document.getElementById('world-book-category');
    const worldBookTagsInput = document.getElementById('world-book-tags');
    const worldBookContentInput = document.getElementById('world-book-content');
    const worldBookListContainer = document.getElementById('world-book-list-container');
    const worldBookIdInput = document.getElementById('world-book-id');
    const searchInput = document.getElementById('world-book-search-input');
    const filterSelect = document.getElementById('world-book-filter-select');

    if (searchInput) {
        searchInput.addEventListener('input', () => renderWorldBookList());
    }
    if (filterSelect) {
        filterSelect.addEventListener('change', () => renderWorldBookList());
    }

    addWorldBookBtn.addEventListener('click', () => {
        currentEditingWorldBookId = null;
        editWorldBookForm.reset();
        document.querySelector('input[name="world-book-position"][value="before"]').checked = true;
        document.getElementById('world-book-global').checked = false;
        document.getElementById('world-book-always-on').checked = true;
        document.getElementById('world-book-weight').value = 100;
        document.getElementById('world-book-keywords-group').style.display = 'none';
        switchScreen('edit-world-book-screen');
    });

    const alwaysOnCheckbox = document.getElementById('world-book-always-on');
    if (alwaysOnCheckbox) {
        alwaysOnCheckbox.addEventListener('change', (e) => {
            document.getElementById('world-book-keywords-group').style.display = e.target.checked ? 'none' : 'block';
        });
    }

    const importWorldBookBtn = document.getElementById('import-world-book-btn');
    const importWorldBookFileInput = document.getElementById('import-world-book-file-input');
    if (importWorldBookBtn && importWorldBookFileInput) {
        importWorldBookBtn.addEventListener('click', () => importWorldBookFileInput.click());
        importWorldBookFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            try {
                await handleImportWorldBookFile(file);
            } catch (err) {
                console.error('世界书导入失败', err);
                showToast('导入失败：' + (err.message || '未知错误'));
            }
        });
    }
    
    editWorldBookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = worldBookNameInput.value.trim();
        const content = worldBookContentInput.value.trim();
        const category = worldBookCategoryInput.value.trim();
        const tagsRaw = worldBookTagsInput ? worldBookTagsInput.value.trim() : '';
        const tags = tagsRaw ? tagsRaw.split(/[,，]+/).map(t => t.trim()).filter(t => t) : [];
        const position = document.querySelector('input[name="world-book-position"]:checked').value;
        const isGlobal = document.getElementById('world-book-global').checked;
        const alwaysOn = document.getElementById('world-book-always-on').checked;
        const keywordsRaw = document.getElementById('world-book-keywords').value.trim();
        const keywords = keywordsRaw ? keywordsRaw.split(/[,，]+/).map(k => k.trim()).filter(k => k) : [];
        const weight = parseInt(document.getElementById('world-book-weight').value, 10) || 100;

        if (!name || !content) return showToast('名称和内容不能为空');
        if (currentEditingWorldBookId) {
            const book = db.worldBooks.find(wb => wb.id === currentEditingWorldBookId);
            if (book) {
                book.name = name;
                book.content = content;
                book.position = position;
                book.category = category;
                book.tags = tags;
                book.isGlobal = isGlobal;
                book.alwaysOn = alwaysOn;
                book.keywords = keywords;
                book.weight = weight;
                if (typeof book.disabled === 'undefined') book.disabled = false;
            }
        } else {
            db.worldBooks.push({
                id: `wb_${Date.now()}`, name, content, position, category, tags, isGlobal, disabled: false,
                alwaysOn, keywords, weight
            });
        }
        await saveData();
        showToast('世界书条目已保存');
        renderWorldBookList();
        switchScreen('world-book-screen');
    });

    worldBookListContainer.addEventListener('click', e => {
        const worldBookItem = e.target.closest('.world-book-item');

        if (isWorldBookMultiSelectMode) {
            if (e.target.matches('.category-checkbox')) {
                const category = e.target.dataset.category;
                const booksInCategory = db.worldBooks.filter(b => (b.category || '未分类') === category);
                const bookIdsInCategory = booksInCategory.map(b => b.id);
                const shouldSelectAll = e.target.checked;

                bookIdsInCategory.forEach(bookId => {
                    if (shouldSelectAll) {
                        selectedWorldBookIds.add(bookId);
                    } else {
                        selectedWorldBookIds.delete(bookId);
                    }
                });
                renderWorldBookList(category); 
                updateWorldBookSelectCount();
                return;
            }

            if (worldBookItem) {
                toggleWorldBookSelection(worldBookItem.dataset.id);
                const category = worldBookItem.closest('.collapsible-section').dataset.category;
                renderWorldBookList(category);
                return;
            }
            
            if (e.target.closest('.category-toggle-area')) {
                e.target.closest('.collapsible-section').classList.toggle('open');
                return;
            }

        } else { 
            if (e.target.closest('.collapsible-header')) {
                e.target.closest('.collapsible-section').classList.toggle('open');
                return;
            }
            
            if (worldBookItem && !e.target.closest('.action-btn')) {
                const book = db.worldBooks.find(wb => wb.id === worldBookItem.dataset.id);
                if (book) {
                    currentEditingWorldBookId = book.id;
                    worldBookIdInput.value = book.id;
                    worldBookNameInput.value = book.name;
                    worldBookContentInput.value = book.content;
                    worldBookCategoryInput.value = book.category || '';
                    if (worldBookTagsInput) {
                        worldBookTagsInput.value = Array.isArray(book.tags) ? book.tags.join(', ') : '';
                    }
                    document.querySelector(`input[name="world-book-position"][value="${book.position}"]`).checked = true;
                    document.getElementById('world-book-global').checked = book.isGlobal || false;
                    
                    const alwaysOn = book.alwaysOn !== false;
                    document.getElementById('world-book-always-on').checked = alwaysOn;
                    document.getElementById('world-book-keywords-group').style.display = alwaysOn ? 'none' : 'block';
                    document.getElementById('world-book-keywords').value = Array.isArray(book.keywords) ? book.keywords.join(', ') : '';
                    document.getElementById('world-book-weight').value = book.weight !== undefined ? book.weight : 100;
                    
                    switchScreen('edit-world-book-screen');
                }
            }
        }
    });

    worldBookListContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const item = e.target.closest('.world-book-item');
        if (item) {
            const category = item.closest('.collapsible-section')?.dataset.category;
            enterWorldBookMultiSelectMode(item.dataset.id, category);
        }
    });
    
    worldBookListContainer.addEventListener('touchstart', (e) => {
        const item = e.target.closest('.world-book-item');
        if (!item) return;
        longPressTimer = setTimeout(() => {
            const category = item.closest('.collapsible-section')?.dataset.category;
            enterWorldBookMultiSelectMode(item.dataset.id, category);
        }, 500);
    });
    worldBookListContainer.addEventListener('mouseup', () => clearTimeout(longPressTimer));
    worldBookListContainer.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
    worldBookListContainer.addEventListener('touchend', () => clearTimeout(longPressTimer));
    worldBookListContainer.addEventListener('touchmove', () => clearTimeout(longPressTimer));

    document.getElementById('delete-selected-world-books-btn').addEventListener('click', deleteSelectedWorldBooks);
    document.getElementById('move-selected-world-books-btn').addEventListener('click', showMoveCategoryModal);
    document.getElementById('toggle-selected-world-books-btn').addEventListener('click', toggleSelectedWorldBooks);
    document.getElementById('cancel-wb-multi-select-btn').addEventListener('click', exitWorldBookMultiSelectMode);

    // 移动到分类模态框的事件处理
    const moveCategoryModal = document.getElementById('world-book-move-category-modal');
    const moveCategoryConfirmBtn = document.getElementById('wb-move-category-confirm-btn');
    const moveCategoryCancelBtn = document.getElementById('wb-move-category-cancel-btn');
    if (moveCategoryModal && moveCategoryConfirmBtn && moveCategoryCancelBtn) {
        moveCategoryConfirmBtn.addEventListener('click', () => {
            const categoryList = document.getElementById('wb-move-category-list');
            const selectedOption = categoryList.querySelector('.wb-move-category-option[data-selected="true"]:not(.wb-move-category-new)');
            if (selectedOption) {
                const targetCategory = selectedOption.dataset.category;
                moveSelectedWorldBooksToCategory(targetCategory);
                moveCategoryModal.classList.remove('visible');
                // 清除选择状态
                categoryList.querySelectorAll('.wb-move-category-option').forEach(opt => {
                    opt.style.backgroundColor = '';
                    delete opt.dataset.selected;
                });
            } else {
                showToast('请先选择一个分类');
            }
        });
        moveCategoryCancelBtn.addEventListener('click', () => {
            moveCategoryModal.classList.remove('visible');
            // 清除选择状态
            const categoryList = document.getElementById('wb-move-category-list');
            if (categoryList) {
                categoryList.querySelectorAll('.wb-move-category-option').forEach(opt => {
                    opt.style.backgroundColor = '';
                    delete opt.dataset.selected;
                });
            }
        });
    }

    const deleteCategoryModal = document.getElementById('world-book-delete-category-modal');
    const deleteCategoryAndEntriesBtn = document.getElementById('wb-delete-category-and-entries-btn');
    const deleteCategoryMoveEntriesBtn = document.getElementById('wb-delete-category-move-entries-btn');
    const deleteCategoryCancelBtn = document.getElementById('wb-delete-category-cancel-btn');
    if (deleteCategoryModal && deleteCategoryAndEntriesBtn && deleteCategoryMoveEntriesBtn && deleteCategoryCancelBtn) {
        deleteCategoryAndEntriesBtn.addEventListener('click', async () => {
            if (!pendingWbCategoryDelete) return;
            const cat = pendingWbCategoryDelete.category;
            const idsToDelete = db.worldBooks.filter(wb => (wb.category || '未分类') === cat).map(wb => wb.id);
            await dexieDB.worldBooks.bulkDelete(idsToDelete);
            db.worldBooks = db.worldBooks.filter(wb => (wb.category || '未分类') !== cat);
            db.characters.forEach(char => {
                if (char.worldBookIds) char.worldBookIds = char.worldBookIds.filter(id => !idsToDelete.includes(id));
            });
            db.groups.forEach(group => {
                if (group.worldBookIds) group.worldBookIds = group.worldBookIds.filter(id => !idsToDelete.includes(id));
            });
            await saveData();
            renderWorldBookList();
            deleteCategoryModal.classList.remove('visible');
            pendingWbCategoryDelete = null;
            showToast(`已删除分类及其下 ${idsToDelete.length} 个条目`);
        });
        deleteCategoryMoveEntriesBtn.addEventListener('click', async () => {
            if (!pendingWbCategoryDelete) return;
            const cat = pendingWbCategoryDelete.category;
            db.worldBooks.forEach(book => {
                if ((book.category || '未分类') === cat) book.category = '';
            });
            await saveData();
            renderWorldBookList();
            deleteCategoryModal.classList.remove('visible');
            pendingWbCategoryDelete = null;
            showToast('已删除分类，条目已移至「未分类」');
        });
        deleteCategoryCancelBtn.addEventListener('click', () => {
            deleteCategoryModal.classList.remove('visible');
            pendingWbCategoryDelete = null;
        });
    }
}

function renderWorldBookList(expandedCategory = null) {
    const worldBookListContainer = document.getElementById('world-book-list-container');
    worldBookListContainer.innerHTML = '';
    
    // 清理之前的 sortable 实例
    if (categorySortable) {
        try { categorySortable.destroy(); } catch (e) {}
        categorySortable = null;
    }
    itemSortables.forEach(s => {
        try { s.destroy(); } catch (e) {}
    });
    itemSortables = [];
    
    let filteredBooks = db.worldBooks;
    
    // 应用搜索和筛选
    const searchInput = document.getElementById('world-book-search-input');
    const filterSelect = document.getElementById('world-book-filter-select');
    
    if (filterSelect && filterSelect.value !== 'all') {
        const filterValue = filterSelect.value;
        if (filterValue === 'global') {
            filteredBooks = filteredBooks.filter(b => b.isGlobal);
        } else if (filterValue === 'disabled') {
            filteredBooks = filteredBooks.filter(b => b.disabled);
        }
    }
    
    let searchKeyword = '';
    if (searchInput && searchInput.value.trim()) {
        searchKeyword = searchInput.value.trim().toLowerCase();
        filteredBooks = filteredBooks.filter(b => {
            const nameMatch = (b.name || '').toLowerCase().includes(searchKeyword);
            const contentMatch = (b.content || '').toLowerCase().includes(searchKeyword);
            const categoryMatch = (b.category || '未分类').toLowerCase().includes(searchKeyword);
            const tagsMatch = Array.isArray(b.tags) && b.tags.some(t => (t || '').toLowerCase().includes(searchKeyword));
            return nameMatch || contentMatch || categoryMatch || tagsMatch;
        });
    }

    document.getElementById('no-world-books-placeholder').style.display = filteredBooks.length === 0 ? 'block' : 'none';
    if (filteredBooks.length === 0) {
        return;
    }

    // 解析多级分类 (支持 / 分隔)
    const categoryTree = {};
    
    filteredBooks.forEach(book => {
        let categoryPath = book.category || '未分类';
        categoryPath = categoryPath.trim().replace(/^[\/\\]+|[\/\\]+$/g, ''); // 移除首尾斜杠
        if (!categoryPath) categoryPath = '未分类';
        
        const parts = categoryPath.split(/[\/\\]/).map(p => p.trim()).filter(p => p);
        if (parts.length === 0) parts.push('未分类');

        let currentLevel = categoryTree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!currentLevel[part]) {
                currentLevel[part] = { _books: [], _children: {} };
            }
            if (i === parts.length - 1) {
                currentLevel[part]._books.push(book);
            }
            currentLevel = currentLevel[part]._children;
        }
    });

    // 递归渲染分类树
    function renderCategoryNode(nodeName, nodeData, level = 0, parentPath = '') {
        const fullPath = parentPath ? `${parentPath}/${nodeName}` : nodeName;
        
        const section = document.createElement('div');
        section.className = 'kkt-group collapsible-section';
        section.style.cssText = `background-color: #fff; border: none; margin-bottom: ${level === 0 ? '15px' : '0'}; box-shadow: none; margin-left: ${level > 0 ? '15px' : '0'}; border-left: ${level > 0 ? '2px solid #f0f0f0' : 'none'}; padding-left: ${level > 0 ? '10px' : '0'};`;
        section.dataset.category = fullPath; 

        // 搜索时，如果该分类包含匹配项，或者该分类本身名称匹配了关键词，则自动展开
        const shouldOpenBySearch = searchKeyword && (
            fullPath.toLowerCase().includes(searchKeyword) || 
            nodeData._books.length > 0 || 
            Object.keys(nodeData._children).length > 0
        );

        if ((isWorldBookMultiSelectMode && expandedCategory && expandedCategory.startsWith(fullPath)) || shouldOpenBySearch) {
            section.classList.add('open');
        }

        const header = document.createElement('div');
        header.className = 'kkt-item collapsible-header';
        header.style.cssText = `background-color: #fff; border-bottom: 1px solid #f5f5f5; cursor: pointer; padding: ${15 - level * 2}px;`;
        
        let checkboxHTML = '';
        if (isWorldBookMultiSelectMode && nodeData._books.length > 0) {
            const allInCategory = nodeData._books.every(book => selectedWorldBookIds.has(book.id));
            checkboxHTML = `<input type="checkbox" class="category-checkbox" data-category="${fullPath}" ${allInCategory ? 'checked' : ''}>`;
        }
        
        const categoryNameEscaped = nodeName.replace(/</g, '<').replace(/>/g, '>');
        const editCategoryBtnHTML = !isWorldBookMultiSelectMode
            ? `<button type="button" class="action-btn world-book-edit-category-btn" title="编辑当前层级名" style="padding: 4px; border: none; background: transparent; margin-right: 4px;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`
            : '';
        const deleteCategoryBtnHTML = !isWorldBookMultiSelectMode
            ? `<button type="button" class="action-btn world-book-delete-category-btn" title="删除该分类（其下条目将移至「未分类」）" style="padding: 6px; border: none; background: transparent; margin-left: 8px;"><img src="https://i.postimg.cc/hGW6B0Wf/icons8-50.png" alt="删除分类" style="width: 20px; height: 20px; object-fit: contain;"></button>`
            : '';
            
        // 只有最底层或有实际书籍的层级才显示多选框
        header.innerHTML = `
            <div class="category-select-area">
                ${checkboxHTML}
            </div>
            <div class="category-toggle-area" style="flex-grow: 1; display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight:bold; color:#333; font-size: ${15 - level}px; display: flex; align-items: center;">
                    ${level > 0 ? '<span style="color:#ccc; margin-right:4px;">└</span>' : ''}${categoryNameEscaped} <span style="color:#999; font-size:12px; font-weight:normal; margin-left:4px;">(${nodeData._books.length})</span>${editCategoryBtnHTML}
                </div>
                <div style="display: flex; align-items: center;">
                    ${deleteCategoryBtnHTML}
                    <span class="collapsible-arrow">▼</span>
                </div>
            </div>
        `;

        if (editCategoryBtnHTML) {
            const editCategoryBtn = header.querySelector('.world-book-edit-category-btn');
            if (editCategoryBtn) {
                editCategoryBtn.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    const newName = prompt('输入新分类名（仅修改当前层级）：', nodeName);
                    if (newName === null) return;
                    const trimmed = newName.trim().replace(/[\/\\]/g, ''); // 不允许输入斜杠
                    if (!trimmed) return showToast('分类名不能为空且不能包含斜杠');
                    if (trimmed === nodeName) return;
                    
                    const parentPrefix = parentPath ? `${parentPath}/` : '';
                    const oldFullPath = `${parentPrefix}${nodeName}`;
                    const newFullPath = `${parentPrefix}${trimmed}`;
                    
                    db.worldBooks.forEach(book => {
                        let cat = book.category || '未分类';
                        if (cat === oldFullPath || cat.startsWith(`${oldFullPath}/`)) {
                            book.category = cat.replace(oldFullPath, newFullPath);
                        }
                    });
                    await saveData();
                    renderWorldBookList();
                    showToast('分类名已修改');
                });
            }
        }
        if (deleteCategoryBtnHTML) {
            const deleteCategoryBtn = header.querySelector('.world-book-delete-category-btn');
            if (deleteCategoryBtn) {
                deleteCategoryBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    let count = 0;
                    db.worldBooks.forEach(b => {
                        let cat = b.category || '未分类';
                        if (cat === fullPath || cat.startsWith(`${fullPath}/`)) count++;
                    });
                    
                    pendingWbCategoryDelete = { category: fullPath, count };
                    document.getElementById('wb-delete-category-modal-title').textContent = `删除分类「${nodeName}」`;
                    document.getElementById('wb-delete-category-modal-desc').textContent = `该分类（及其子分类）下共有 ${count} 个条目。要同时删除这些条目，还是将它们移至「未分类」？`;
                    document.getElementById('world-book-delete-category-modal').classList.add('visible');
                });
            }
        }

        const contentContainer = document.createElement('div');
        contentContainer.className = 'collapsible-content';
        
        // 渲染当前层级的书籍
        if (nodeData._books.length > 0) {
            const categoryList = document.createElement('ul');
            categoryList.className = 'list-container';
            categoryList.style.padding = '0';

            nodeData._books.forEach(book => {
                const li = document.createElement('li');
                li.className = 'list-item world-book-item';
                li.dataset.id = book.id;
                const isDisabled = !!book.disabled;
                if (isDisabled) li.classList.add('world-book-item-disabled');

            if (isWorldBookMultiSelectMode) {
                li.classList.add('is-selecting');
                if (selectedWorldBookIds.has(book.id)) {
                    li.classList.add('selected');
                }
            }

            const disabledBadge = isDisabled ? ' <span class="world-book-disabled-badge" style="background:#e0e0e0;color:#666;font-size:10px;padding:2px 6px;border-radius:3px;margin-left:6px;">未启用</span>' : '';
            let metaHTML = '';
            if (book.alwaysOn !== false) {
                metaHTML += '<span style="font-size:10px;color:#fff;background:var(--primary-color);padding:2px 6px;border-radius:4px;margin-right:4px;">常驻</span>';
            }
            if (book.weight !== undefined) {
                metaHTML += `<span style="font-size:10px;color:#666;background:#eee;padding:2px 6px;border-radius:4px;margin-right:4px;">权重:${book.weight}</span>`;
            }
            
            let tagsHTML = '';
            if (Array.isArray(book.tags) && book.tags.length > 0) {
                tagsHTML = `<div class="item-tags" style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px;">${book.tags.map(t => `<span style="font-size:10px;color:var(--primary-color);background:rgba(255,128,171,0.1);padding:2px 6px;border-radius:4px;">#${t}</span>`).join('')}</div>`;
            }
            
            let keywordHTML = '';
            if (book.alwaysOn === false && Array.isArray(book.keywords) && book.keywords.length > 0) {
                keywordHTML = `<div style="font-size:11px;color:#888;margin-top:2px;">🔑 ${book.keywords.join(', ')}</div>`;
            }
            
            li.innerHTML = `<div class="item-details" style="padding-left: 0;"><div class="item-name" style="margin-bottom: 4px;">${book.name}${book.isGlobal ? ' <span style="display:inline-block;background:#4CAF50;color:white;font-size:10px;padding:2px 6px;border-radius:3px;margin-left:6px;">全局</span>' : ''}${disabledBadge}</div><div style="margin-bottom: 4px;">${metaHTML}</div>${tagsHTML}${keywordHTML}<div class="item-preview">${book.content}</div></div>`;
            
            if (!isWorldBookMultiSelectMode) {
                const btnWrap = document.createElement('div');
                btnWrap.className = 'world-book-item-actions';
                btnWrap.style.cssText = 'position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; align-items: center; gap: 4px;';
                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'action-btn world-book-toggle-enabled-btn';
                toggleBtn.title = isDisabled ? '点击启用' : '点击停用（停用后不会被读取）';
                toggleBtn.style.cssText = 'padding: 4px 8px; border: none; border-radius: 4px; font-size: 12px; background: ' + (isDisabled ? '#e0e0e0' : '#e8f5e9') + '; color: ' + (isDisabled ? '#666' : '#2e7d32') + ';';
                toggleBtn.textContent = isDisabled ? '启用' : '停用';
                toggleBtn.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    const b = db.worldBooks.find(wb => wb.id === book.id);
                    if (b) {
                        b.disabled = !b.disabled;
                        await saveData();
                        renderWorldBookList();
                        showToast(b.disabled ? '已停用，该条目不会被读取' : '已启用');
                    }
                });
                const delBtn = document.createElement('button');
                delBtn.className = 'action-btn';
                delBtn.style.cssText = 'padding: 6px; border: none; background: transparent;';
                delBtn.title = '删除世界书';
                delBtn.innerHTML = '<img src="https://i.postimg.cc/hGW6B0Wf/icons8-50.png" alt="删除" style="width: 22px; height: 22px; object-fit: contain;">';
                delBtn.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    if (!confirm('确定要删除这个世界书条目吗？')) return;
                    const bookIdToDelete = book.id;
                    await dexieDB.worldBooks.delete(bookIdToDelete);
                    db.worldBooks = db.worldBooks.filter(wb => wb.id !== bookIdToDelete);
                    db.characters.forEach(char => {
                        if (char.worldBookIds) char.worldBookIds = char.worldBookIds.filter(id => id !== bookIdToDelete);
                    });
                    db.groups.forEach(group => {
                        if (group.worldBookIds) group.worldBookIds = group.worldBookIds.filter(id => id !== bookIdToDelete);
                    });
                    await saveData();
                    renderWorldBookList();
                    showToast('世界书条目已删除');
                });
                btnWrap.appendChild(toggleBtn);
                btnWrap.appendChild(delBtn);
                li.style.position = 'relative';
                li.appendChild(btnWrap);
            }
                categoryList.appendChild(li);
            });
            contentContainer.appendChild(categoryList);
        }

        // 递归渲染子分类
        const sortedChildren = Object.keys(nodeData._children).sort((a, b) => a.localeCompare(b));
        sortedChildren.forEach(childName => {
            const childSection = renderCategoryNode(childName, nodeData._children[childName], level + 1, fullPath);
            contentContainer.appendChild(childSection);
        });

        section.appendChild(header);
        section.appendChild(contentContainer);
        return section;
    }

    // 从根节点开始渲染 (读取保存的分类顺序)
    let rootKeys = Object.keys(categoryTree);
    if (db.worldBookCategoryOrder) {
        rootKeys.sort((a, b) => {
            const indexA = db.worldBookCategoryOrder.indexOf(a);
            const indexB = db.worldBookCategoryOrder.indexOf(b);
            if (indexA === -1 && indexB === -1) return a.localeCompare(b);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
    } else {
        rootKeys.sort((a, b) => {
            if (a === '未分类') return 1;
            if (b === '未分类') return -1;
            return a.localeCompare(b);
        });
    }

    rootKeys.forEach(rootKey => {
        const section = renderCategoryNode(rootKey, categoryTree[rootKey]);
        worldBookListContainer.appendChild(section);
    });

    // 初始化分类拖拽排序（移动端/触摸设备不启用，避免影响点击）
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (typeof Sortable !== 'undefined' && !isWorldBookMultiSelectMode && !searchKeyword && !isTouchDevice) {
        categorySortable = new Sortable(worldBookListContainer, {
            animation: 150,
            handle: '.collapsible-header', // 点击头部拖拽
            ghostClass: 'sortable-ghost',
            onEnd: async function () {
                const newOrder = Array.from(worldBookListContainer.children).map(el => {
                    const categoryPath = el.dataset.category;
                    return categoryPath.split(/[\/\\]/)[0]; // 记录根节点顺序
                });
                db.worldBookCategoryOrder = newOrder;
                await saveData();
            }
        });

        // 初始化条目拖拽排序
        const lists = worldBookListContainer.querySelectorAll('.list-container');
        lists.forEach(listEl => {
            const sortable = new Sortable(listEl, {
                animation: 150,
                group: 'worldBookItems', // 允许在不同分类间拖拽
                ghostClass: 'sortable-ghost',
                onEnd: async function (evt) {
                    // 更新数据库中的分类和顺序
                    const itemEl = evt.item;
                    const bookId = itemEl.dataset.id;
                    const book = db.worldBooks.find(b => b.id === bookId);
                    
                    const newSection = itemEl.closest('.collapsible-section');
                    if (newSection && book) {
                        book.category = newSection.dataset.category;
                    }

                    // 重新排序 db.worldBooks (简单地把当前列表的所有书移到最后，保持它们之间的相对顺序)
                    // 更严谨的做法是更新所有书籍的 order 字段，但这里为了简便，依赖数组自身的顺序
                    const currentListIds = Array.from(evt.to.children).map(el => el.dataset.id);
                    const otherBooks = db.worldBooks.filter(b => !currentListIds.includes(b.id));
                    const sortedBooksInList = currentListIds.map(id => db.worldBooks.find(b => b.id === id)).filter(b => b);
                    
                    db.worldBooks = [...otherBooks, ...sortedBooksInList];

                    await dexieDB.worldBooks.bulkPut(db.worldBooks);
                    await saveData();
                    
                    // 如果跨分类拖拽了，需要重新渲染以更新数量等
                    if (evt.from !== evt.to) {
                        renderWorldBookList(newSection ? newSection.dataset.category : null);
                    }
                }
            });
            itemSortables.push(sortable);
        });
    }
}

function renderCategorizedWorldBookList(container, books, selectedIds, idPrefix) {
    container.innerHTML = '';
    if (!books || books.length === 0) {
        container.innerHTML = '<li style="color: #888; text-align: center; padding: 15px;">暂无世界书条目</li>';
        return;
    }

    // 选择世界书界面也支持多级分类渲染（这里为了简化展示，将多级路径拍平展示）
    const groupedBooks = books.reduce((acc, book) => {
        let category = book.category || '未分类';
        category = category.trim().replace(/^[\/\\]+|[\/\\]+$/g, '');
        if (!category) category = '未分类';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(book);
        return acc;
    }, {});

    const sortedCategories = Object.keys(groupedBooks).sort((a, b) => {
        if (a === '未分类') return 1;
        if (b === '未分类') return -1;
        return a.localeCompare(b);
    });

    sortedCategories.forEach(category => {
        const categoryBooks = groupedBooks[category];
        const allInCategorySelected = categoryBooks.every(book => selectedIds.includes(book.id));

        const groupEl = document.createElement('div');
        groupEl.className = 'world-book-category-group';

        groupEl.innerHTML = `
            <div class="world-book-category-header">
                <input type="checkbox" class="category-checkbox" ${allInCategorySelected ? 'checked' : ''}>
                <span class="category-name">${category}</span>
                <span class="category-arrow">▼</span>
            </div>
            <ul class="world-book-items-list">
                ${categoryBooks.map(book => {
                    const isChecked = selectedIds.includes(book.id);
                    return `
                        <li class="world-book-select-item">
                            <input type="checkbox" class="item-checkbox" id="${idPrefix}-${book.id}" value="${book.id}" ${isChecked ? 'checked' : ''}>
                            <label for="${idPrefix}-${book.id}">${book.name}</label>
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
        container.appendChild(groupEl);
    });

    container.querySelectorAll('.world-book-category-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return; 
            const group = header.closest('.world-book-category-group');
            group.classList.toggle('open');
        });
    });

    container.querySelectorAll('.category-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const group = e.target.closest('.world-book-category-group');
            const itemCheckboxes = group.querySelectorAll('.item-checkbox');
            itemCheckboxes.forEach(itemCb => {
                itemCb.checked = e.target.checked;
            });
        });
    });

    container.querySelectorAll('.item-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const group = e.target.closest('.world-book-category-group');
            const categoryCheckbox = group.querySelector('.category-checkbox');
            const allItems = group.querySelectorAll('.item-checkbox');
            const allChecked = Array.from(allItems).every(item => item.checked);
            categoryCheckbox.checked = allChecked;
        });
    });
}
