// Global variables for this extension
const EXTENSION_NAME = 'st-text-recorder';
let treeData = [];
let selectedNodeId = null;
let isEnabled = true;
let currentTheme = 'default';

// Helper to get extension context safely in 1.18.0+
function getExtensionSettings() {
    const context = SillyTavern?.getContext?.();
    return context?.extensionSettings || context?.extension_settings || window.extension_settings || {};
}

function getSaveSettingsDebounced() {
    const context = SillyTavern?.getContext?.();
    return context?.saveSettingsDebounced || window.saveSettingsDebounced || (() => {});
}

// Robust fallback for mobile browsers and HTTP LAN access, where the Clipboard API
// is unavailable because the page is not considered a secure context.
function copyTextWithLegacyApi(text) {
    // 1. Direct copy via the active on-screen textarea if it contains the text
    const mainTextarea = document.getElementById('st-text-recorder-textarea');
    if (mainTextarea && mainTextarea.value === text && document.body.contains(mainTextarea)) {
        try {
            const prevStart = mainTextarea.selectionStart;
            const prevEnd = mainTextarea.selectionEnd;
            mainTextarea.focus();
            mainTextarea.select();
            mainTextarea.setSelectionRange(0, text.length);
            const successful = document.execCommand('copy');
            mainTextarea.setSelectionRange(prevStart, prevEnd);
            if (successful) return true;
        } catch (e) {
            console.warn('Direct textarea copy failed, trying temporary element', e);
        }
    }

    // 2. Fallback using a temporary in-viewport element (compatible with iOS Safari & mobile Chrome)
    const temporaryTextarea = document.createElement('textarea');
    temporaryTextarea.value = text;
    // On iOS Safari, readonly prevents select() from selecting text,
    // and off-screen elements (-9999px) are rejected by WebKit security checks.
    Object.assign(temporaryTextarea.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '2em',
        height: '2em',
        padding: '0',
        border: 'none',
        outline: 'none',
        boxShadow: 'none',
        background: 'transparent',
        opacity: '0.01',
        pointerEvents: 'none',
        zIndex: '-1'
    });

    document.body.appendChild(temporaryTextarea);

    const isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent);
    if (isIOS) {
        temporaryTextarea.contentEditable = true;
        temporaryTextarea.readOnly = false;
        const range = document.createRange();
        range.selectNodeContents(temporaryTextarea);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        temporaryTextarea.setSelectionRange(0, 999999);
    } else {
        temporaryTextarea.focus();
        temporaryTextarea.select();
        temporaryTextarea.setSelectionRange(0, temporaryTextarea.value.length);
    }

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch (err) {
        console.error('execCommand copy error:', err);
    } finally {
        temporaryTextarea.remove();
    }
    return copied;
}

async function copyTextToClipboard(text) {
    if (text === undefined || text === null) text = '';
    if (window.isSecureContext && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.warn('Clipboard API failed, trying compatibility fallback', err);
        }
    }

    return copyTextWithLegacyApi(text);
}

// Helper to save settings
function saveSettings() {
    const settings = getExtensionSettings();
    if (!settings[EXTENSION_NAME]) {
        settings[EXTENSION_NAME] = { tree: [], enabled: true, theme: 'default' };
    }
    settings[EXTENSION_NAME].tree = treeData;
    settings[EXTENSION_NAME].enabled = isEnabled;
    settings[EXTENSION_NAME].theme = currentTheme;
    
    const saveFunc = getSaveSettingsDebounced();
    if (typeof saveFunc === 'function') {
        saveFunc();
    }
}

// Helper to generate unique IDs
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Tree Data Operations
function addNode(parentId, type) {
    const newNode = {
        id: generateId(),
        type: type,
        name: '', // Empty initially for inline editing
        content: type === 'file' ? '' : undefined,
        children: type === 'folder' ? [] : undefined,
        isEditing: true // flag for render
    };

    if (parentId) {
        const parent = findNode(treeData, parentId);
        if (parent && parent.type === 'folder') {
            if (!parent.children) parent.children = [];
            parent.children.push(newNode);
            parent.isOpen = true; // Force open folder to show inline input
        }
    } else {
        treeData.push(newNode);
    }
    saveSettings();
    renderTree();
}

function moveNode(id, direction) {
    let parentArray = null;
    let index = treeData.findIndex(n => n.id === id);
    if (index !== -1) {
        parentArray = treeData;
    } else {
        function findParentArray(nodes) {
            for (let node of nodes) {
                if (node.children) {
                    let idx = node.children.findIndex(n => n.id === id);
                    if (idx !== -1) return node.children;
                    let found = findParentArray(node.children);
                    if (found) return found;
                }
            }
            return null;
        }
        parentArray = findParentArray(treeData);
        if (parentArray) {
            index = parentArray.findIndex(n => n.id === id);
        }
    }

    if (parentArray && index !== -1) {
        if (direction === 'up' && index > 0) {
            [parentArray[index - 1], parentArray[index]] = [parentArray[index], parentArray[index - 1]];
            saveSettings();
            renderTree();
        } else if (direction === 'down' && index < parentArray.length - 1) {
            [parentArray[index + 1], parentArray[index]] = [parentArray[index], parentArray[index + 1]];
            saveSettings();
            renderTree();
        }
    }
}

function findNode(nodes, id) {
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
            const found = findNode(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

function deleteNodeFromTree(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) {
            nodes.splice(i, 1);
            return true;
        }
        if (nodes[i].children) {
            if (deleteNodeFromTree(nodes[i].children, id)) return true;
        }
    }
    return false;
}

// Apply Theme
function applyTheme() {
    const container = document.getElementById('st-text-recorder-container');
    if (!container) return;
    container.classList.remove('st-theme-dark', 'st-theme-blue', 'st-theme-green', 'st-theme-amber', 'st-theme-light', 'st-theme-warm', 'st-theme-cyan');
    if (currentTheme !== 'default') {
        container.classList.add(`st-theme-${currentTheme}`);
    }
}

// UI Rendering
function renderTree() {
    const treeContainer = document.getElementById('st-text-recorder-tree');
    if (!treeContainer) return;
    treeContainer.innerHTML = '';
    
    function buildTreeHTML(nodes, parentElement) {
        nodes.forEach(node => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'st-tree-item';
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'st-tree-item-label';
            if (node.id === selectedNodeId) labelDiv.classList.add('selected');
            
            const icon = document.createElement('i');
            if (node.type === 'folder') {
                icon.className = node.isOpen ? 'fa-solid fa-folder-open st-tree-item-icon' : 'fa-solid fa-folder st-tree-item-icon';
            } else {
                icon.className = 'fa-solid fa-file-lines st-tree-item-icon';
            }
            labelDiv.appendChild(icon);

            if (node.isEditing) {
                // Inline Input
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'st-tree-inline-input';
                input.value = node.name;
                input.placeholder = node.type === 'folder' ? '文件夹名称...' : '文本名称...';
                
                const saveName = () => {
                    if (input.value.trim() !== '') {
                        node.name = input.value.trim();
                    } else if (node.name === '') {
                        // Deleted if empty and new
                        deleteNodeFromTree(treeData, node.id);
                    }
                    node.isEditing = false;
                    saveSettings();
                    renderTree();
                };

                input.addEventListener('blur', saveName);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') {
                        if (node.name === '') deleteNodeFromTree(treeData, node.id);
                        node.isEditing = false;
                        saveSettings();
                        renderTree();
                    }
                });

                labelDiv.appendChild(input);
                itemDiv.appendChild(labelDiv);
                parentElement.appendChild(itemDiv);
                
                // Focus immediately
                setTimeout(() => input.focus(), 0);
            } else {
                const text = document.createElement('span');
                text.className = 'st-tree-item-text';
                text.textContent = node.name;
                labelDiv.appendChild(text);

                // Actions Container
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'st-tree-item-actions';
                actionsDiv.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                });

                // Secondary Actions (Hidden initially)
                const secondaryDiv = document.createElement('div');
                secondaryDiv.className = 'st-tree-secondary-actions';

                const moveUpBtn = document.createElement('i');
                moveUpBtn.className = 'fa-solid fa-arrow-up st-tree-action-btn';
                moveUpBtn.title = '上移';
                moveUpBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveNode(node.id, 'up');
                });
                secondaryDiv.appendChild(moveUpBtn);

                const moveDownBtn = document.createElement('i');
                moveDownBtn.className = 'fa-solid fa-arrow-down st-tree-action-btn';
                moveDownBtn.title = '下移';
                moveDownBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveNode(node.id, 'down');
                });
                secondaryDiv.appendChild(moveDownBtn);

                const renameBtn = document.createElement('i');
                renameBtn.className = 'fa-solid fa-pen st-tree-action-btn';
                renameBtn.title = '重命名';
                renameBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    node.isEditing = true;
                    renderTree();
                });
                secondaryDiv.appendChild(renameBtn);

                const deleteBtn = document.createElement('i');
                deleteBtn.className = 'fa-solid fa-trash st-tree-action-btn';
                deleteBtn.title = '删除';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const msg = node.type === 'folder' 
                        ? `确定要删除文件夹 "${node.name}" 以及它里面的所有内容吗？`
                        : `确定要删除文本 "${node.name}" 吗？`;
                    if (confirm(msg)) {
                        deleteNodeFromTree(treeData, node.id);
                        saveSettings();
                        if (selectedNodeId === node.id) {
                            selectedNodeId = null;
                            selectNode(null);
                        } else {
                            renderTree();
                        }
                    }
                });
                secondaryDiv.appendChild(deleteBtn);
                
                actionsDiv.appendChild(secondaryDiv);

                // Primary Actions (Permanent)
                const primaryDiv = document.createElement('div');
                primaryDiv.className = 'st-tree-primary-actions';

                let addFileBtn, addFolderBtn;

                if (node.type === 'folder') {
                    addFileBtn = document.createElement('i');
                    addFileBtn.className = 'fa-solid fa-file-circle-plus st-tree-action-btn st-tree-add-file-btn';
                    addFileBtn.title = '新建文本';
                    addFileBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        addNode(node.id, 'file');
                    });
                    primaryDiv.appendChild(addFileBtn);

                    addFolderBtn = document.createElement('i');
                    addFolderBtn.className = 'fa-solid fa-folder-plus st-tree-action-btn st-tree-add-folder-btn';
                    addFolderBtn.title = '新建文件夹';
                    addFolderBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        addNode(node.id, 'folder');
                    });
                    primaryDiv.appendChild(addFolderBtn);
                }

                // More / Edit Button
                const moreBtn = document.createElement('i');
                moreBtn.className = 'fa-solid fa-ellipsis-vertical st-tree-action-btn st-tree-more-btn';
                moreBtn.title = '更多操作 (重命名、删除、排序)';
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isShowing = secondaryDiv.classList.toggle('show');
                    if (addFileBtn) addFileBtn.style.display = isShowing ? 'none' : '';
                    if (addFolderBtn) addFolderBtn.style.display = isShowing ? 'none' : '';
                });
                primaryDiv.appendChild(moreBtn);

                actionsDiv.appendChild(primaryDiv);
                labelDiv.appendChild(actionsDiv);
                
                itemDiv.appendChild(labelDiv);

                // Events
                labelDiv.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    node.isEditing = true;
                    renderTree();
                });

                labelDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (node.type === 'folder') {
                        node.isOpen = !node.isOpen;
                        if (childrenContainer) {
                            childrenContainer.className = node.isOpen ? 'st-tree-children' : 'st-tree-children collapsed';
                            icon.className = node.isOpen ? 'fa-solid fa-folder-open st-tree-item-icon' : 'fa-solid fa-folder st-tree-item-icon';
                        }
                        if (selectedNodeId === node.id) {
                            selectNode(null);
                        } else {
                            selectNode(node.id);
                        }
                        saveSettings();
                    } else {
                        if (selectedNodeId === node.id) {
                            selectNode(null);
                        } else {
                            selectNode(node.id);
                        }
                    }
                });

                // Context menu to rename
                labelDiv.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    node.isEditing = true;
                    renderTree();
                });
                
                let childrenContainer = null;
                if (node.type === 'folder' && node.children) {
                    childrenContainer = document.createElement('div');
                    childrenContainer.className = node.isOpen ? 'st-tree-children' : 'st-tree-children collapsed';
                    buildTreeHTML(node.children, childrenContainer);
                    itemDiv.appendChild(childrenContainer);
                }
                
                parentElement.appendChild(itemDiv);
            }
        });
    }
    
    buildTreeHTML(treeData, treeContainer);
}

function selectNode(id) {
    selectedNodeId = id;
    renderTree();
    
    const node = findNode(treeData, id);
    const editorArea = document.getElementById('st-text-recorder-editor-area');
    const emptyState = document.getElementById('st-text-recorder-empty-state');
    const textarea = document.getElementById('st-text-recorder-textarea');
    const titleSpan = document.getElementById('st-text-recorder-current-title');
    
    if (node && !node.isEditing) {
        if (node.type === 'file') {
            editorArea.style.display = 'flex';
            emptyState.style.display = 'none';
            textarea.value = node.content || '';
            titleSpan.textContent = node.name;
        } else {
            editorArea.style.display = 'none';
            emptyState.style.display = 'flex';
            emptyState.innerHTML = `<span>📂 文件夹：${node.name}</span>`;
        }
    } else {
        editorArea.style.display = 'none';
        emptyState.style.display = 'flex';
        emptyState.innerHTML = `<span>请在左侧选择或新建一个文本以开始编辑...<br><br><small>(右键点击可重命名文件夹/文件)</small></span>`;
    }
}

// Dragging and Resizing Logic
function makeDraggable(container, header) {
    let isDragging = false;
    let startX, startY, initialX, initialY;
    let wasDragged = false;

    const onStart = (e) => {
        const clientX = e.type.includes('mouse') ? e.clientX : (e.touches?.[0]?.clientX || 0);
        const clientY = e.type.includes('mouse') ? e.clientY : (e.touches?.[0]?.clientY || 0);
        const target = e.target;
        
        if (!container.classList.contains('minimized')) {
            if (!target.closest('.st-text-recorder-header')) return;
            if (target.closest('.st-text-recorder-controls')) return;
        }
        
        isDragging = true;
        wasDragged = false;
        startX = clientX;
        startY = clientY;
        const rect = container.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        document.body.style.userSelect = 'none';
        container.classList.add('dragging');
        if (e.type.startsWith('touch') && container.classList.contains('minimized')) {
            e.preventDefault();
        }
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const clientX = e.type.includes('mouse') ? e.clientX : (e.touches?.[0]?.clientX || 0);
        const clientY = e.type.includes('mouse') ? e.clientY : (e.touches?.[0]?.clientY || 0);
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            wasDragged = true;
        }
        if (e.type.startsWith('touch')) {
            e.preventDefault();
        }
        container.style.left = `${initialX + dx}px`;
        container.style.top = `${initialY + dy}px`;
        container.style.right = 'auto';
    };

    const onEnd = () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
            container.classList.remove('dragging');
        }
    };

    container.addEventListener('mousedown', onStart);
    container.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);

    // Expand when clicking the minimized icon, but ONLY if it wasn't a drag action
    container.addEventListener('click', (e) => {
        if (container.classList.contains('minimized')) {
            if (wasDragged) {
                e.preventDefault();
                e.stopPropagation();
            } else {
                container.classList.remove('minimized');
            }
        }
    });
}

function makeResizable(container, handle) {
    if (!handle) return;
    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    const onStart = (e) => {
        if (container.classList.contains('minimized')) return;
        isResizing = true;
        const clientX = e.type.includes('mouse') ? e.clientX : (e.touches?.[0]?.clientX || 0);
        const clientY = e.type.includes('mouse') ? e.clientY : (e.touches?.[0]?.clientY || 0);
        startX = clientX;
        startY = clientY;
        startWidth = container.offsetWidth;
        startHeight = container.offsetHeight;
        document.body.style.userSelect = 'none';
        container.classList.add('resizing');
        e.stopPropagation();
        if (e.type.startsWith('touch')) {
            e.preventDefault();
        }
    };

    const onMove = (e) => {
        if (!isResizing) return;
        const clientX = e.type.includes('mouse') ? e.clientX : (e.touches?.[0]?.clientX || 0);
        const clientY = e.type.includes('mouse') ? e.clientY : (e.touches?.[0]?.clientY || 0);
        if (e.type.startsWith('touch')) {
            e.preventDefault();
        }
        const minWidth = Math.min(220, window.innerWidth - 20);
        const minHeight = Math.min(180, window.innerHeight - 20);
        const maxWidth = window.innerWidth - 10;
        const maxHeight = window.innerHeight - 10;
        const width = Math.min(maxWidth, Math.max(minWidth, startWidth + (clientX - startX)));
        const height = Math.min(maxHeight, Math.max(minHeight, startHeight + (clientY - startY)));
        container.style.width = `${width}px`;
        container.style.height = `${height}px`;
    };

    const onEnd = () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = '';
            container.classList.remove('resizing');
        }
    };

    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
}

function makeSidebarResizable(sidebar, handle) {
    if (!handle || !sidebar) return;
    let isResizing = false;
    let startX, startWidth;

    const onStart = (e) => {
        isResizing = true;
        const clientX = e.type.includes('mouse') ? e.clientX : (e.touches?.[0]?.clientX || 0);
        startX = clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.userSelect = 'none';
        e.stopPropagation();
        if (e.type.startsWith('touch')) {
            e.preventDefault();
        }
    };

    const onMove = (e) => {
        if (!isResizing) return;
        const clientX = e.type.includes('mouse') ? e.clientX : (e.touches?.[0]?.clientX || 0);
        if (e.type.startsWith('touch')) {
            e.preventDefault();
        }
        const maxSidebarWidth = Math.min(400, window.innerWidth * 0.7);
        sidebar.style.width = `${Math.max(80, Math.min(startWidth + (clientX - startX), maxSidebarWidth))}px`;
    };

    const onEnd = () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = '';
        }
    };

    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
}

// Core Button Injection
function updateToggleButtonVisibility() {
    const toggleBtn = document.getElementById('st-text-recorder-toggle-btn');
    if (toggleBtn) {
        toggleBtn.style.display = isEnabled ? 'flex' : 'none';
    }
    const container = document.getElementById('st-text-recorder-container');
    if (container && !isEnabled) {
        container.style.display = 'none';
    }
}

async function init() {
    try {
        console.log('[Text Recorder] Initializing...');
        
        // Ensure settings exist and load data safely
        const settings = getExtensionSettings();
        if (!settings[EXTENSION_NAME]) {
            settings[EXTENSION_NAME] = { tree: [], enabled: true, theme: 'default' };
        }
        treeData = settings[EXTENSION_NAME].tree || [];
        isEnabled = settings[EXTENSION_NAME].enabled !== false;
        currentTheme = settings[EXTENSION_NAME].theme || 'default';
        
        // Fetch HTML template dynamically
        const myPath = import.meta.url;
        const htmlUrl = new URL('index.html', myPath).href;
        const htmlResponse = await fetch(htmlUrl);
        if (!htmlResponse.ok) throw new Error(`Failed to load index.html from ${htmlUrl}`);
        const htmlText = await htmlResponse.text();
        
        // Parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const mainWindowHtml = doc.getElementById('st-text-recorder-container').outerHTML;
        const settingsPanelHtml = doc.getElementById('st-text-recorder-settings-panel').outerHTML;

        // Insert main window
        if (!document.getElementById('st-text-recorder-container')) {
            document.body.insertAdjacentHTML('beforeend', mainWindowHtml);
        }
        
        // Insert settings panel
        const extensionSettingsPanel = document.getElementById('extensions_settings');
        if (extensionSettingsPanel && !document.getElementById('st-text-recorder-settings-panel')) {
            extensionSettingsPanel.insertAdjacentHTML('beforeend', settingsPanelHtml);
        }

        // Apply theme immediately
        applyTheme();

        // Settings Logic
        const enableCheckbox = document.getElementById('st-text-recorder-enable-checkbox');
        if (enableCheckbox) {
            enableCheckbox.checked = isEnabled;
            enableCheckbox.addEventListener('change', (e) => {
                isEnabled = e.target.checked;
                saveSettings();
                updateToggleButtonVisibility();
            });
        }
        const themeSelect = document.getElementById('st-text-recorder-theme-select');
        if (themeSelect) {
            themeSelect.value = currentTheme;
            themeSelect.addEventListener('change', (e) => {
                currentTheme = e.target.value;
                saveSettings();
                applyTheme();
            });
        }

        // 2. Inject Toggle Button into Magic Wand Menu
        const injectButton = () => {
            if (document.getElementById('st-text-recorder-toggle-btn')) return; // Already injected

            const wandMenu = document.getElementById('extensionsMenu') || document.getElementById('extensions_menu');
            if (wandMenu) {
                const btn = document.createElement('div');
                btn.className = 'list-group-item flex-container flexGap5 interactable';
                btn.id = 'st-text-recorder-toggle-btn';
                btn.setAttribute('role', 'listitem');
                btn.setAttribute('tabindex', '0');
                btn.innerHTML = `<div class="fa-fw fa-solid fa-book extensionsMenuExtensionButton"></div><span>文本记录器</span>`;
                wandMenu.appendChild(btn);

                btn.addEventListener('click', togglePopup);
                updateToggleButtonVisibility();
                console.log('[Text Recorder] Injected into #extensionsMenu');
                return;
            }
        };

        const togglePopup = () => {
            if (!isEnabled) {
                if (window.toastr) window.toastr.warning('文本记录器目前处于停用状态，请在插件设置中开启。');
                return;
            }
            const container = document.getElementById('st-text-recorder-container');
            container.style.display = container.style.display === 'none' ? 'flex' : 'none';
            if (container.style.display === 'flex') {
                container.classList.remove('minimized');
                renderTree();
            }
        };
        
        // Try to inject
        injectButton();
        setTimeout(injectButton, 2000);
        setTimeout(injectButton, 5000);
        
        document.addEventListener('click', (e) => {
            const wandBtn = e.target.closest('#send_textarea_wand, .fa-wand-magic-sparkles');
            if (wandBtn) {
                setTimeout(() => {
                    const openPopups = document.querySelectorAll('.popup, .list-group, #slash_commands_popup, #extensionsMenu, #extensions_menu_dropdown');
                    for (const popup of openPopups) {
                        if (popup.style.display !== 'none' && !popup.querySelector('#st-text-recorder-toggle-btn')) {
                            const btn = document.createElement('div');
                            btn.className = 'list-group-item flex-container flexGap5 interactable';
                            btn.id = 'st-text-recorder-toggle-btn';
                            btn.setAttribute('role', 'listitem');
                            btn.setAttribute('tabindex', '0');
                            btn.innerHTML = `<div class="fa-fw fa-solid fa-book extensionsMenuExtensionButton"></div><span>文本记录器</span>`;
                            btn.addEventListener('click', togglePopup);
                            popup.appendChild(btn);
                            updateToggleButtonVisibility();
                            break;
                        }
                    }
                }, 100);
            }
        });

        // ADD SLASH COMMAND
        const context = SillyTavern.getContext();
        if (context.registerSlashCommand) {
            context.registerSlashCommand(
                'recorder',
                () => { togglePopup(); return ''; },
                [],
                '打开或关闭文本记录器悬浮窗 (Toggle Text Recorder)',
                true,
                true
            );
        }

        // 3. Setup Floating Window UI Events
        const container = document.getElementById('st-text-recorder-container');
        const closeBtn = document.getElementById('st-text-recorder-close');
        const minimizeBtn = document.getElementById('st-text-recorder-minimize');
        const header = document.getElementById('st-text-recorder-header');
        const resizeHandle = document.getElementById('st-text-recorder-resize-handle');
        const sidebar = document.querySelector('.st-text-recorder-sidebar');
        const sidebarResizer = document.getElementById('st-text-recorder-resizer-x');
        
        closeBtn.addEventListener('click', () => {
            container.style.display = 'none';
        });
        
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            container.classList.add('minimized');
        });

        makeDraggable(container, header);
        makeResizable(container, resizeHandle);
        makeSidebarResizable(sidebar, sidebarResizer);

        // Global Sidebar Add Buttons
        document.getElementById('st-text-recorder-add-folder').addEventListener('click', () => {
            addNode(null, 'folder');
        });

        document.getElementById('st-text-recorder-add-file').addEventListener('click', () => {
            addNode(null, 'file');
        });

        const textarea = document.getElementById('st-text-recorder-textarea');
        
        document.getElementById('st-text-recorder-copy').addEventListener('click', async () => {
            try {
                const copied = await copyTextToClipboard(textarea.value);
                if (!copied) throw new Error('The browser rejected the copy command');
                if (window.toastr) window.toastr.success('文本已复制到剪贴板');
            } catch (err) {
                console.error('Failed to copy', err);
                if (window.toastr) window.toastr.error('复制失败，请长按文本手动复制');
            }
        });

        document.getElementById('st-text-recorder-paste').addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
                textarea.selectionStart = textarea.selectionEnd = start + text.length;
            } catch (err) {
                console.error('Failed to paste', err);
                if (window.toastr) window.toastr.error('无法读取剪贴板，请检查浏览器权限');
            }
        });

        document.getElementById('st-text-recorder-clear').addEventListener('click', () => {
            if (confirm('确定要清空文本吗？（清空后必须点击保存才会生效）')) {
                textarea.value = '';
            }
        });

        document.getElementById('st-text-recorder-save').addEventListener('click', () => {
            if (selectedNodeId) {
                const node = findNode(treeData, selectedNodeId);
                if (node && node.type === 'file') {
                    node.content = textarea.value;
                    saveSettings();
                    if (window.toastr) window.toastr.success('修改已保存');
                }
            }
        });

        renderTree();
        console.log('[Text Recorder] Successfully initialized!');
    } catch (err) {
        console.error('[Text Recorder] Initialization failed:', err);
    }
}

// 规范：监听 APP_READY 事件后再操作 DOM
jQuery(() => {
    const context = SillyTavern.getContext();
    if (context && context.eventSource && context.event_types) {
        context.eventSource.on(context.event_types.APP_READY, init);
    } else {
        setTimeout(init, 2000);
    }
});
