import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

// Global variables for this extension
const EXTENSION_NAME = 'st-text-recorder';
let treeData = [];
let selectedNodeId = null;

// Ensure settings exist
if (!extension_settings[EXTENSION_NAME]) {
    extension_settings[EXTENSION_NAME] = {
        tree: []
    };
}
treeData = extension_settings[EXTENSION_NAME].tree || [];

// Helper to generate unique IDs
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Helper to save settings
function saveSettings() {
    extension_settings[EXTENSION_NAME].tree = treeData;
    saveSettingsDebounced();
}

// Tree Data Operations
function addNode(parentId, type) {
    const name = prompt(`Enter name for new ${type}:`, `New ${type}`);
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
            if (node.id === selectedNodeId) labelDiv.parentElement.classList.add('selected');
            
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
                    // toggle folder
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
                    const action = confirm(`Add new file in [${node.name}]?\nOK = File, Cancel = Folder`);
                    if (action) {
                        addNode(node.id, 'file');
                    } else {
                        const addFolder = confirm('Add new folder instead?');
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
    // Save current before switching if it's a file? We are using manual save.
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
            // It's a folder, show empty state or just info
            editorArea.style.display = 'none';
            emptyState.style.display = 'flex';
            emptyState.innerHTML = `<span>Folder: ${node.name} <br> (Right click folder in tree to add items inside)</span>`;
        }
    } else {
        editorArea.style.display = 'none';
        emptyState.style.display = 'flex';
        emptyState.innerHTML = `<span>Select or create a text file to start writing...</span>`;
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

// Initialization
async function init() {
    // 1. Inject HTML
    const htmlResponse = await fetch('/scripts/extensions/third-party/一个简单的记录文字小工具/index.html');
    const htmlText = await htmlResponse.text();
    document.body.insertAdjacentHTML('beforeend', htmlText);

    // 2. Add Top Bar Button
    const topBar = document.getElementById('extensions_menu') || document.getElementById('rm_button_group_chats') || document.body;
    const btnHtml = `<div id="st-text-recorder-toggle-btn" class="menu_button" title="Text Recorder">
                        <i class="fa-solid fa-book"></i>
                     </div>`;
    
    // Fallback to extensions menu or top bar
    const extensionMenu = document.getElementById('extensions_menu');
    if (extensionMenu) {
        const item = document.createElement('div');
        item.className = 'list-group-item flex-container flexGapSm interactable';
        item.id = 'st-text-recorder-toggle-btn';
        item.innerHTML = `<div class="flex-container flexGapSm extensionsMenuLabel"><i class="fa-solid fa-book"></i> Text Recorder</div>`;
        extensionMenu.appendChild(item);
    } else {
        document.body.insertAdjacentHTML('beforeend', `<div id="st-text-recorder-toggle-btn" style="position:fixed;top:10px;right:150px;z-index:9999;background:#333;color:white;padding:5px;cursor:pointer;border-radius:4px;" title="Text Recorder"><i class="fa-solid fa-book"></i></div>`);
    }

    // 3. Setup Elements
    const container = document.getElementById('st-text-recorder-container');
    const toggleBtn = document.getElementById('st-text-recorder-toggle-btn');
    const closeBtn = document.getElementById('st-text-recorder-close');
    const header = document.getElementById('st-text-recorder-header');
    const resizeHandle = document.getElementById('st-text-recorder-resize-handle');
    const sidebar = document.querySelector('.st-text-recorder-sidebar');
    const sidebarResizer = document.getElementById('st-text-recorder-resizer-x');

    // UI Toggles
    toggleBtn.addEventListener('click', () => {
        container.style.display = container.style.display === 'none' ? 'flex' : 'none';
        if (container.style.display === 'flex') {
            renderTree();
        }
    });
    
    closeBtn.addEventListener('click', () => {
        container.style.display = 'none';
    });

    // Make Draggable and Resizable
    makeDraggable(container, header);
    makeResizable(container, resizeHandle);
    makeSidebarResizable(sidebar, sidebarResizer);

    // Sidebar Toolbar Actions
    document.getElementById('st-text-recorder-add-folder').addEventListener('click', () => {
        // Add to root if nothing or file selected, else add to folder
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

    // Editor Toolbar Actions
    const textarea = document.getElementById('st-text-recorder-textarea');
    
    document.getElementById('st-text-recorder-copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(textarea.value);
            toastr?.success('Copied to clipboard');
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
            toastr?.error('Could not read clipboard');
        }
    });

    document.getElementById('st-text-recorder-clear').addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the text? (You must click save to apply)')) {
            textarea.value = '';
        }
    });

    document.getElementById('st-text-recorder-save').addEventListener('click', () => {
        if (selectedNodeId) {
            const node = findNode(treeData, selectedNodeId);
            if (node && node.type === 'file') {
                node.content = textarea.value;
                saveSettings();
                toastr?.success('File saved');
            }
        }
    });

    document.getElementById('st-text-recorder-delete').addEventListener('click', () => {
        if (!selectedNodeId) return;
        const node = findNode(treeData, selectedNodeId);
        if (!node) return;
        
        if (confirm(`Are you sure you want to delete ${node.type === 'folder' ? 'folder and ALL its contents' : 'file'} "${node.name}"?`)) {
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
