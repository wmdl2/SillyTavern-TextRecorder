import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

// Global variables for this extension
const EXTENSION_NAME = 'st-text-recorder';
let treeData = [];
let selectedNodeId = null;
let isEnabled = true;

// Ensure settings exist
if (!extension_settings[EXTENSION_NAME]) {
    extension_settings[EXTENSION_NAME] = {
        tree: [],
        enabled: true
    };
}
treeData = extension_settings[EXTENSION_NAME].tree || [];
isEnabled = extension_settings[EXTENSION_NAME].enabled !== false; // default true

// Helper to generate unique IDs
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Helper to save settings
function saveSettings() {
    extension_settings[EXTENSION_NAME].tree = treeData;
    extension_settings[EXTENSION_NAME].enabled = isEnabled;
    saveSettingsDebounced();
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

            // Context menu simulation (right click) for adding inside folders
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
    // 1. Fetch HTML template
    const htmlResponse = await fetch('/scripts/extensions/third-party/一个简单的记录文字小工具/index.html');
    const htmlText = await htmlResponse.text();
    
    // Parse HTML to separate settings block from main window
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const mainWindowHtml = doc.getElementById('st-text-recorder-container').outerHTML;
    const settingsPanelHtml = doc.getElementById('st-text-recorder-settings-panel').outerHTML;

    // Insert main window to body
    document.body.insertAdjacentHTML('beforeend', mainWindowHtml);
    
    // Insert settings panel to #extensions_settings
    const extensionSettingsPanel = document.getElementById('extensions_settings');
    if (extensionSettingsPanel) {
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

    // 2. Inject Toggle Button into Magic Wand Menu (#extensions_menu)
    // ST might recreate the menu dynamically, so we wait for it or inject gracefully
    const injectIntoMagicWand = () => {
        const wandMenu = document.getElementById('extensions_menu');
        if (wandMenu && !document.getElementById('st-text-recorder-toggle-btn')) {
            const btn = document.createElement('div');
            btn.className = 'list-group-item flex-container flexGapSm interactable';
            btn.id = 'st-text-recorder-toggle-btn';
            btn.innerHTML = `<div class="flex-container flexGapSm extensionsMenuLabel"><i class="fa-solid fa-book"></i> 文本记录本</div>`;
            wandMenu.appendChild(btn);

            btn.addEventListener('click', () => {
                const container = document.getElementById('st-text-recorder-container');
                container.style.display = container.style.display === 'none' ? 'flex' : 'none';
                if (container.style.display === 'flex') {
                    renderTree();
                }
            });
            updateToggleButtonVisibility();
        }
    };
    
    // Attempt to inject immediately, or setup an observer/timeout if it opens later
    injectIntoMagicWand();
    
    // Some themes build #extensions_menu later or when wand is clicked
    const wandButton = document.getElementById('send_textarea_wand') || document.querySelector('.fa-wand-magic-sparkles')?.closest('.menu_button');
    if (wandButton) {
        wandButton.addEventListener('click', () => {
            setTimeout(injectIntoMagicWand, 100);
        });
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

    // Sidebar Add Buttons
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

    // Editor Actions
    const textarea = document.getElementById('st-text-recorder-textarea');
    
    document.getElementById('st-text-recorder-copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(textarea.value);
            toastr?.success('文本已复制到剪贴板');
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
            toastr?.error('无法读取剪贴板，请检查浏览器权限');
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
                toastr?.success('修改已保存');
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
}

jQuery(async () => {
    init();
});
