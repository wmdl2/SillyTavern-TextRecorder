// Global variables for this extension
const EXTENSION_NAME = 'st-text-recorder';
let treeData = [];
let selectedNodeId = null;
let isEnabled = true;

// Helper to get extension context safely in 1.18.0+
function getExtensionSettings() {
    const context = SillyTavern?.getContext?.();
    return context?.extension_settings || window.extension_settings || {};
}

function getSaveSettingsDebounced() {
    const context = SillyTavern?.getContext?.();
    return context?.saveSettingsDebounced || window.saveSettingsDebounced || (() => {});
}

// Helper to save settings
function saveSettings() {
    const settings = getExtensionSettings();
    if (!settings[EXTENSION_NAME]) {
        settings[EXTENSION_NAME] = { tree: [], enabled: true };
    }
    settings[EXTENSION_NAME].tree = treeData;
    settings[EXTENSION_NAME].enabled = isEnabled;
    
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
    const typeName = type === 'folder' ? '文件夹' : '文本';
    const name = prompt(`请输入新${typeName}的名称:`, `新建${typeName}`);
    if (!name) return;

    const newNode = {
        id: generateId(),
        type: type,
        name: name,
        content: type === 'file' ? '' : undefined,
        children: type === 'folder' ? [] : undefined
    };

    if (parentId) {
        const parent = findNode(treeData, parentId);
        if (parent && parent.type === 'folder') {
            parent.children.push(newNode);
        }
    } else {
        treeData.push(newNode);
    }
    saveSettings();
    renderTree();
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
            icon.className = node.type === 'folder' ? 'fa-solid fa-folder st-tree-item-icon' : 'fa-solid fa-file-lines st-tree-item-icon';
            
            const text = document.createElement('span');
            text.className = 'st-tree-item-text';
            text.textContent = node.name;
            
            labelDiv.appendChild(icon);
            labelDiv.appendChild(text);
            itemDiv.appendChild(labelDiv);
            
            // Events
            labelDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                if (node.type === 'folder') {
                    if (childrenContainer) {
                        childrenContainer.classList.toggle('collapsed');
                        icon.className = childrenContainer.classList.contains('collapsed') 
                            ? 'fa-solid fa-folder st-tree-item-icon' 
                            : 'fa-solid fa-folder-open st-tree-item-icon';
                    }
                    selectNode(node.id);
                } else {
                    selectNode(node.id);
                }
            });

            labelDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                selectNode(node.id);
                if (node.type === 'folder') {
                    const action = confirm(`确定要在 [${node.name}] 中新建文本吗？\n点【确定】新建文本，点【取消】可选择新建文件夹。`);
                    if (action) {
                        addNode(node.id, 'file');
                    } else {
                        const addFolder = confirm(`要在 [${node.name}] 中新建文件夹吗？`);
                        if (addFolder) addNode(node.id, 'folder');
                    }
                }
            });
            
            let childrenContainer = null;
            if (node.type === 'folder' && node.children) {
                childrenContainer = document.createElement('div');
                childrenContainer.className = 'st-tree-children collapsed';
                buildTreeHTML(node.children, childrenContainer);
                itemDiv.appendChild(childrenContainer);
            }
            
            parentElement.appendChild(itemDiv);
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
    
    if (node) {
        if (node.type === 'file') {
            editorArea.style.display = 'flex';
            emptyState.style.display = 'none';
            textarea.value = node.content || '';
            titleSpan.textContent = node.name;
        } else {
            editorArea.style.display = 'none';
            emptyState.style.display = 'flex';
            emptyState.innerHTML = `<span>📂 文件夹：${node.name} <br> <small>(在左侧右键点击该文件夹可添加子项)</small></span>`;
        }
    } else {
        editorArea.style.display = 'none';
        emptyState.style.display = 'flex';
        emptyState.innerHTML = `<span>请在左侧选择或新建一个文本以开始编辑...</span>`;
    }
}

// Dragging and Resizing Logic
function makeDraggable(container, handle) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('.st-text-recorder-controls')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = container.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        container.style.left = `${initialX + dx}px`;
        container.style.top = `${initialY + dy}px`;
        container.style.right = 'auto'; // clear right to use left/top
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.userSelect = '';
        }
    });
}

function makeResizable(container, handle) {
    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = container.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const width = startWidth + (e.clientX - startX);
        const height = startHeight + (e.clientY - startY);
        container.style.width = `${Math.max(300, width)}px`;
        container.style.height = `${Math.max(200, height)}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = '';
        }
    });
}

function makeSidebarResizable(sidebar, handle) {
    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.getBoundingClientRect().width;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const width = startWidth + (e.clientX - startX);
        sidebar.style.width = `${Math.max(100, Math.min(width, 400))}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = '';
        }
    });
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
            settings[EXTENSION_NAME] = { tree: [], enabled: true };
        }
        treeData = settings[EXTENSION_NAME].tree || [];
        isEnabled = settings[EXTENSION_NAME].enabled !== false;
        
        // 1. Fetch HTML template dynamically
        // Use import.meta.url to safely construct the path to index.html to avoid 404s
        const myPath = import.meta.url;
        const htmlUrl = new URL('index.html', myPath).href;
        
        const htmlResponse = await fetch(htmlUrl);
        if (!htmlResponse.ok) {
            throw new Error(`Failed to load index.html from ${htmlUrl}`);
        }
        const htmlText = await htmlResponse.text();
        
        // Parse HTML to separate settings block from main window
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const mainWindowHtml = doc.getElementById('st-text-recorder-container').outerHTML;
        const settingsPanelHtml = doc.getElementById('st-text-recorder-settings-panel').outerHTML;

        // Insert main window to body
        if (!document.getElementById('st-text-recorder-container')) {
            document.body.insertAdjacentHTML('beforeend', mainWindowHtml);
        }
        
        // Insert settings panel to #extensions_settings
        const extensionSettingsPanel = document.getElementById('extensions_settings');
        if (extensionSettingsPanel && !document.getElementById('st-text-recorder-settings-panel')) {
            extensionSettingsPanel.insertAdjacentHTML('beforeend', settingsPanelHtml);
        }

        // Settings Toggle Logic
        const enableCheckbox = document.getElementById('st-text-recorder-enable-checkbox');
        if (enableCheckbox) {
            enableCheckbox.checked = isEnabled;
            enableCheckbox.addEventListener('change', (e) => {
                isEnabled = e.target.checked;
                saveSettings();
                updateToggleButtonVisibility();
            });
        }

        // 2. Inject Toggle Button into Magic Wand Menu
        const injectButton = () => {
            if (document.getElementById('st-text-recorder-toggle-btn')) return; // Already injected

            // Attempt 1: The standard #extensionsMenu (camelCase in 1.18+)
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
                renderTree();
            }
        };
        
        // Try to inject
        injectButton();
        setTimeout(injectButton, 2000);
        setTimeout(injectButton, 5000);
        
        // Also listen to ANY clicks on the magic wand to inject into dynamic popups
        document.addEventListener('click', (e) => {
            const wandBtn = e.target.closest('#send_textarea_wand, .fa-wand-magic-sparkles');
            if (wandBtn) {
                setTimeout(() => {
                    // Try to find the opened popup list
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

        // 2.5 ADD SLASH COMMAND (Official API)
        const context = SillyTavern.getContext();
        if (context.registerSlashCommand) {
            context.registerSlashCommand(
                'recorder',
                () => {
                    togglePopup();
                    return '';
                },
                [],
                '打开或关闭文本记录器悬浮窗 (Toggle Text Recorder)',
                true,
                true
            );
            console.log('[Text Recorder] Slash command /recorder registered.');
        }

        // 3. Setup Floating Window UI Events
        const container = document.getElementById('st-text-recorder-container');
        const closeBtn = document.getElementById('st-text-recorder-close');
        const header = document.getElementById('st-text-recorder-header');
        const resizeHandle = document.getElementById('st-text-recorder-resize-handle');
        const sidebar = document.querySelector('.st-text-recorder-sidebar');
        const sidebarResizer = document.getElementById('st-text-recorder-resizer-x');
        
        closeBtn.addEventListener('click', () => {
            container.style.display = 'none';
        });

        makeDraggable(container, header);
        makeResizable(container, resizeHandle);
        makeSidebarResizable(sidebar, sidebarResizer);

        document.getElementById('st-text-recorder-add-folder').addEventListener('click', () => {
            let targetId = null;
            if (selectedNodeId) {
                const node = findNode(treeData, selectedNodeId);
                if (node && node.type === 'folder') targetId = selectedNodeId;
            }
            addNode(targetId, 'folder');
        });

        document.getElementById('st-text-recorder-add-file').addEventListener('click', () => {
            let targetId = null;
            if (selectedNodeId) {
                const node = findNode(treeData, selectedNodeId);
                if (node && node.type === 'folder') targetId = selectedNodeId;
            }
            addNode(targetId, 'file');
        });

        const textarea = document.getElementById('st-text-recorder-textarea');
        
        document.getElementById('st-text-recorder-copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(textarea.value);
                if (window.toastr) window.toastr.success('文本已复制到剪贴板');
            } catch (err) {
                console.error('Failed to copy', err);
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

        document.getElementById('st-text-recorder-delete').addEventListener('click', () => {
            if (!selectedNodeId) return;
            const node = findNode(treeData, selectedNodeId);
            if (!node) return;
            
            const msg = node.type === 'folder' 
                ? `确定要删除文件夹 "${node.name}" 以及它里面的所有内容吗？`
                : `确定要删除文本 "${node.name}" 吗？`;
                
            if (confirm(msg)) {
                deleteNodeFromTree(treeData, selectedNodeId);
                saveSettings();
                selectedNodeId = null;
                selectNode(null);
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
        // Fallback for older/unusual ST versions
        setTimeout(init, 2000);
    }
});
