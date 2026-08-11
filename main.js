// === Attachment Organizer Plugin ===

const { Plugin, Notice, Modal, Setting, PluginSettingTab, TFile, TFolder, MarkdownView, SecretComponent, requestUrl } = require('obsidian');

const DEFAULT_SETTINGS = {
    attachmentFolder: 'attachments',
    attachmentExtensions: 'png,jpg,jpeg,gif,bmp,svg,mp3,wav,mp4,mov,pdf',
    confirmPurge: true,
    ignoreFolders: '',
    autoOrganizeMode: 'date', // 'none', 'date', 'type', 'tag', 'custom'
    customPattern: '{{type}}/{{year}}-{{month}}',
    organizeOnLoad: false,
    organizeInterval: 0, // minutes, 0 = disabled
    organizationMode: 'obsidian-settings', // 'obsidian-settings', 'same-location', or 'separate-folder'
    separateFolderName: 'attachments',
    // OCR Settings
    ocrEnabled: false,
    ocrProvider: 'custom', // 'custom', 'openai', 'anthropic', 'gemini'
    ocrApiKeyName: '',  // name of the secret in Obsidian SecretStorage (not the key itself)
    ocrModel: 'gemini-2.5-flash',
    // OpenAI
    ocrOpenAiModel: 'gpt-4o-mini',
    ocrOpenAiApiKeyName: '',
    // Anthropic
    ocrAnthropicModel: 'claude-sonnet-4-5',
    ocrAnthropicApiKeyName: '',
    // Custom (any OpenAI-compatible server: Ollama, LM Studio, vLLM, llama.cpp, ...)
    ocrCustomBaseUrl: 'http://localhost:11434/v1',
    ocrCustomModel: 'qwen2.5vl:7b',
    ocrCustomApiKeyName: '',
    ocrCustomTimeout: 600, // seconds — local models can be slow
    // Watch / output folders
    ocrWatchFolderMode: 'custom', // 'custom', 'obsidian-settings', 'vaultkeeper'
    ocrWatchFolder: 'assets/attachments',
    ocrOutputFolderMode: 'custom', // 'custom', 'obsidian-settings', 'vaultkeeper', 'source'
    ocrOutputFolder: 'assets/attachments/ocr',
    ocrOutputSubfolder: 'ocr', // appended to the resolved base for non-custom modes; '' = no subfolder
    ocrAutoProcess: true,
    ocrAutoProcessNewFiles: true,
    ocrAutoProcessModifiedFiles: true,
    ocrProcessedField: 'ocr-processed',
    ocrFrontmatterEnabled: false,
    // One "key: value" per line. Values support the same tokens as the body
    // template: {{filename}}, {{path}}, {{link}}, {{date}}, {{datetime}},
    // {{time}}, {{status}}, {{provider}}, {{model}}.
    ocrFrontmatterProperties: 'source: "[[{{path}}]]"\nprocessed: {{date}}\nstatus: {{status}}',
    ocrPrompt: 'Extract all text from this image/document. Provide the text content clearly and accurately.',
    ocrTemplate: '# OCR Result for {{filename}}\n\n## Extracted Text\n\n{{content}}',
    ocrBatchSize: 1,
    ocrMaxFileSize: 10485760, // 10MB in bytes
    ocrForceReprocess: false,
    // Paste Rename Settings
    pasteRenameMode: 'none', // 'none', 'date', 'custom', 'ask', 'date-ask'
    pasteRenameDateFormat: '{{year}}-{{month}}-{{day}}', // tokens: {{year}} {{month}} {{day}} {{time}} {{type}}
    pasteRenameCustomPattern: '{{year}}-{{month}}-{{day}}_{{filename}}',
};

class AttachmentOrganizerSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions() {
        const s = this.plugin.settings;
        const save = () => this.plugin.saveSettings();

        const defs = [
            // Support & Links
            {
                type: 'group',
                heading: 'Support & Links',
                items: [
                    {
                        name: 'Support & links',
                        searchable: false,
                        render: (setting) => {
                            setting.nameEl.remove();
                            setting.descEl.remove();
                            setting.controlEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;justify-content:flex-start;width:100%';
                            const links = [
                                { text: '☕ Buy Me a Coffee', href: 'https://buymeacoffee.com/erinskidds',                      cls: 'support-link coffee-link' },
                                { text: '⭐ Star on GitHub',  href: 'https://github.com/DudeThatsErin/vaultkeeper',             cls: 'support-link github-link' },
                                { text: '🐛 Report Issues',  href: 'https://github.com/DudeThatsErin/vaultkeeper/issues',      cls: 'support-link issues-link' },
                                { text: '💬 Discord Support', href: 'https://discord.gg/XcJWhE3SEA',                           cls: 'support-link discord-link' },
                            ];
                            links.forEach(({ text, href, cls }) => {
                                const a = setting.controlEl.createEl('a', { text, href });
                                a.className = cls;
                                a.target = '_blank';
                                a.rel = 'noopener noreferrer';
                            });
                        },
                    },
                ],
            },
            // General
            {
                type: 'group',
                heading: 'General',
                items: [
                    {
                        name: 'Attachment extensions',
                        desc: 'Comma-separated file extensions treated as attachments',
                        control: { type: 'text', key: 'attachmentExtensions', placeholder: 'png,jpg,jpeg,...' }
                    },
                    {
                        name: 'Ignore folders',
                        desc: 'Comma-separated folder paths to skip when organizing or purging',
                        control: { type: 'text', key: 'ignoreFolders', placeholder: 'folder1,folder2/subfolder' }
                    },
                ],
            },
            // Organization
            {
                type: 'group',
                heading: 'Organization',
                items: [
                    {
                        name: 'Destination',
                        desc: 'Where to move attachments when organizing',
                        control: {
                            type: 'dropdown', key: 'organizationMode',
                            options: {
                                'obsidian-settings': 'Use Obsidian settings',
                                'same-location': 'Same location as file',
                                'separate-folder': 'Separate folder'
                            }
                        }
                    },
                    {
                        name: 'Obsidian attachment folder',
                        desc: 'Read-only. Change this in Obsidian → Settings → Files and links → Default location for new attachments.',
                        aliases: ['default location for new attachments'],
                        visible: () => s.organizationMode === 'obsidian-settings',
                        render: (setting) => {
                            setting.setName('Obsidian attachment folder')
                                .setDesc(this.plugin.describeObsidianAttachmentSetting());
                        }
                    },
                    {
                        name: 'Default folder name',
                        desc: 'Pre-filled folder name shown in the organize prompt',
                        aliases: ['separate folder'],
                        visible: () => s.organizationMode === 'separate-folder',
                        control: { type: 'text', key: 'separateFolderName', placeholder: 'attachments' }
                    },
                    {
                        name: 'Sort into subfolders by',
                        desc: 'Sort attachments into subfolders inside the destination',
                        visible: () => s.organizationMode !== 'same-location',
                        control: {
                            type: 'dropdown', key: 'autoOrganizeMode',
                            options: {
                                'none': 'No subfolders',
                                'date': 'Date (year/month)',
                                'type': 'File type (extension)',
                                'custom': 'Custom pattern'
                            }
                        }
                    },
                    {
                        name: 'Custom subfolder pattern',
                        desc: 'Available tokens: {{year}}, {{month}}, {{day}}, {{type}}, {{filename}}',
                        aliases: ['organize pattern', 'subfolder template'],
                        visible: () => s.autoOrganizeMode === 'custom' && s.organizationMode !== 'same-location',
                        control: { type: 'text', key: 'customPattern', placeholder: '{{type}}/{{year}}-{{month}}' }
                    },
                    {
                        name: 'Organize on startup',
                        desc: 'Automatically organize attachments each time Obsidian starts',
                        control: { type: 'toggle', key: 'organizeOnLoad' }
                    },
                    {
                        name: 'Auto-organize interval (minutes)',
                        desc: 'Re-organize on a schedule. 0 = disabled.',
                        aliases: ['schedule', 'automatic organize'],
                        control: { type: 'slider', key: 'organizeInterval', min: 0, max: 120, step: 5 }
                    },
                ],
            },
            // Paste rename
            {
                type: 'group',
                heading: 'Paste Rename',
                items: [
                    {
                        name: 'Rename mode',
                        desc: 'How to rename attachments when pasted or dropped into a note',
                        aliases: ['paste', 'drop', 'rename pasted files'],
                        control: {
                            type: 'dropdown', key: 'pasteRenameMode',
                            options: {
                                'none': 'Do not rename',
                                'date': 'Date-based (automatic)',
                                'custom': 'Custom pattern (automatic)',
                                'ask': 'Ask each time',
                                'date-ask': 'Date-based + ask to confirm'
                            }
                        }
                    },
                    {
                        name: 'Date format pattern',
                        desc: 'Tokens: {{year}}, {{month}}, {{day}}, {{time}}, {{type}}, {{filename}}, {{original}}',
                        aliases: ['paste rename date format'],
                        visible: () => s.pasteRenameMode === 'date' || s.pasteRenameMode === 'date-ask',
                        control: { type: 'text', key: 'pasteRenameDateFormat', placeholder: '{{year}}-{{month}}-{{day}}' }
                    },
                    {
                        name: 'Custom rename pattern',
                        desc: 'Tokens: {{year}}, {{month}}, {{day}}, {{time}}, {{type}}, {{filename}}, {{original}}',
                        aliases: ['paste rename custom pattern'],
                        visible: () => s.pasteRenameMode === 'custom',
                        control: { type: 'text', key: 'pasteRenameCustomPattern', placeholder: '{{year}}-{{month}}-{{day}}_{{filename}}' }
                    },
                ],
            },
            // Purge
            {
                type: 'group',
                heading: 'Purge',
                items: [
                    {
                        name: 'Confirm before purging',
                        desc: 'Show a confirmation prompt before deleting unlinked attachments',
                        aliases: ['purge confirm', 'delete unlinked'],
                        control: { type: 'toggle', key: 'confirmPurge' }
                    },
                ],
            },
            // OCR
            {
                type: 'group',
                heading: 'OCR',
                items: [
                    {
                        name: 'Enable OCR',
                        desc: 'Extract text from images and PDFs using an AI model',
                        aliases: ['optical character recognition', 'gemini', 'openai', 'anthropic', 'ollama', 'image text'],
                        control: { type: 'toggle', key: 'ocrEnabled' }
                    },
                    {
                        name: 'OCR provider',
                        desc: 'Which AI service performs the text extraction',
                        aliases: ['ocr provider', 'chatgpt', 'claude', 'ollama', 'local model'],
                        visible: () => s.ocrEnabled,
                        control: {
                            type: 'dropdown', key: 'ocrProvider',
                            options: {
                                'custom': 'Custom / self-hosted (OpenAI-compatible)',
                                'openai': 'OpenAI (ChatGPT)',
                                'anthropic': 'Anthropic (Claude)',
                                'gemini': 'Google Gemini'
                            }
                        }
                    },

                    // --- Custom / self-hosted ---
                    {
                        name: 'Custom server base URL',
                        desc: 'OpenAI-compatible endpoint root. Ollama: http://localhost:11434/v1 — LM Studio: http://localhost:1234/v1',
                        aliases: ['ollama url', 'custom endpoint', 'base url', 'local ai'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'custom',
                        control: { type: 'text', key: 'ocrCustomBaseUrl', placeholder: 'http://localhost:11434/v1' }
                    },
                    {
                        name: 'Custom model',
                        desc: 'Model name as the server reports it. Must be vision-capable (e.g. qwen2.5vl:7b, llama3.2-vision:11b, minicpm-v).',
                        aliases: ['ollama model', 'custom model'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'custom',
                        control: { type: 'text', key: 'ocrCustomModel', placeholder: 'qwen2.5vl:7b' }
                    },
                    {
                        name: 'Custom API key (optional)',
                        desc: 'Leave unset for servers that do not require auth, such as a local Ollama.',
                        aliases: ['custom api key'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'custom',
                        render: (setting) => {
                            setting.setName('Custom API key (optional)')
                                .setDesc('Leave unset for servers that do not require auth, such as a local Ollama.')
                                .addComponent(el => new SecretComponent(this.app, el)
                                    .setValue(s.ocrCustomApiKeyName)
                                    .onChange(async (value) => {
                                        s.ocrCustomApiKeyName = value;
                                        await save();
                                    }));
                        }
                    },
                    {
                        name: 'Custom request timeout (seconds)',
                        desc: 'How long to wait for the model before giving up. Local models on CPU can take several minutes.',
                        aliases: ['ocr timeout'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'custom',
                        control: { type: 'slider', key: 'ocrCustomTimeout', min: 30, max: 1800, step: 30 }
                    },
                    {
                        name: 'Test custom server',
                        desc: 'Check that the base URL responds and the model is available',
                        aliases: ['test connection'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'custom',
                        render: (setting) => {
                            setting.setName('Test custom server')
                                .setDesc('Check that the base URL responds and the model is available')
                                .addButton(btn => btn
                                    .setButtonText('Test connection')
                                    .onClick(() => this.plugin.testCustomOcrServer()));
                        }
                    },

                    // --- OpenAI ---
                    {
                        name: 'OpenAI API key',
                        desc: 'Select a saved secret, or create one with your key from platform.openai.com',
                        aliases: ['openai key', 'chatgpt key'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'openai',
                        render: (setting) => {
                            const frag = document.createDocumentFragment();
                            frag.appendText('Select a saved secret, or create one with your key from ');
                            const link = frag.createEl('a', { text: 'the OpenAI dashboard', href: 'https://platform.openai.com/api-keys' });
                            link.setAttr('target', '_blank');
                            link.setAttr('rel', 'noopener noreferrer');
                            setting.setName('OpenAI API key').setDesc(frag)
                                .addComponent(el => new SecretComponent(this.app, el)
                                    .setValue(s.ocrOpenAiApiKeyName)
                                    .onChange(async (value) => {
                                        s.ocrOpenAiApiKeyName = value;
                                        await save();
                                    }));
                        }
                    },
                    {
                        name: 'OpenAI model',
                        desc: 'Any vision-capable OpenAI model',
                        aliases: ['gpt model', 'chatgpt model'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'openai',
                        control: { type: 'text', key: 'ocrOpenAiModel', placeholder: 'gpt-4o-mini' }
                    },

                    // --- Anthropic ---
                    {
                        name: 'Anthropic API key',
                        desc: 'Select a saved secret, or create one with your key from the Anthropic Console',
                        aliases: ['claude key', 'anthropic key'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'anthropic',
                        render: (setting) => {
                            const frag = document.createDocumentFragment();
                            frag.appendText('Select a saved secret, or create one with your key from ');
                            const link = frag.createEl('a', { text: 'the Anthropic Console', href: 'https://console.anthropic.com/settings/keys' });
                            link.setAttr('target', '_blank');
                            link.setAttr('rel', 'noopener noreferrer');
                            setting.setName('Anthropic API key').setDesc(frag)
                                .addComponent(el => new SecretComponent(this.app, el)
                                    .setValue(s.ocrAnthropicApiKeyName)
                                    .onChange(async (value) => {
                                        s.ocrAnthropicApiKeyName = value;
                                        await save();
                                    }));
                        }
                    },
                    {
                        name: 'Anthropic model',
                        desc: 'Any vision-capable Claude model',
                        aliases: ['claude model'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'anthropic',
                        control: { type: 'text', key: 'ocrAnthropicModel', placeholder: 'claude-sonnet-4-5' }
                    },

                    // --- Gemini ---
                    {
                        name: 'Gemini API key',
                        desc: 'Select a saved secret, or create one with your key from Google AI Studio',
                        aliases: ['ocr api key', 'gemini key', 'google ai'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'gemini',
                        render: (setting) => {
                            const frag = document.createDocumentFragment();
                            frag.appendText('Select a saved secret, or create one with your key from ');
                            const link = frag.createEl('a', { text: 'Google AI Studio', href: 'https://makersuite.google.com/app/apikey' });
                            link.setAttr('target', '_blank');
                            link.setAttr('rel', 'noopener noreferrer');
                            setting.setName('Gemini API key').setDesc(frag)
                                .addComponent(el => new SecretComponent(this.app, el)
                                    .setValue(s.ocrApiKeyName)
                                    .onChange(async (value) => {
                                        s.ocrApiKeyName = value;
                                        await save();
                                    }));
                        }
                    },
                    {
                        name: 'Gemini model',
                        desc: 'The Gemini model to use for OCR',
                        aliases: ['ocr model', 'gemini 2.5', 'gemini flash'],
                        visible: () => s.ocrEnabled && s.ocrProvider === 'gemini',
                        control: {
                            type: 'dropdown', key: 'ocrModel',
                            options: {
                                'gemini-2.5-flash': 'Gemini 2.5 Flash (Recommended)',
                                'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite (Fastest, Free tier)',
                                'gemini-2.5-pro': 'Gemini 2.5 Pro (Most capable)',
                                'gemini-3.5-flash': 'Gemini 3.5 Flash (Most intelligent)',
                                'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite (Budget)',
                                'gemini-1.5-flash': 'Gemini 1.5 Flash (Legacy)',
                                'gemini-1.5-pro': 'Gemini 1.5 Pro (Legacy)'
                            }
                        }
                    },

                    // --- Folders ---
                    {
                        name: 'OCR watch folder',
                        desc: 'Which folder to monitor for images and PDFs to OCR',
                        aliases: ['ocr folder', 'watch folder'],
                        visible: () => s.ocrEnabled,
                        control: {
                            type: 'dropdown', key: 'ocrWatchFolderMode',
                            options: {
                                'custom': 'A specific folder',
                                'obsidian-settings': "Obsidian's attachment folder",
                                'vaultkeeper': "Vaultkeeper's organize destination"
                            }
                        }
                    },
                    {
                        name: 'Watch folder path',
                        desc: 'Folder to monitor for images and PDFs to OCR',
                        aliases: ['ocr watch path'],
                        visible: () => s.ocrEnabled && s.ocrWatchFolderMode === 'custom',
                        control: { type: 'text', key: 'ocrWatchFolder', placeholder: 'assets/attachments' }
                    },
                    {
                        name: 'Resolved watch folder',
                        desc: 'Read-only preview',
                        visible: () => s.ocrEnabled && s.ocrWatchFolderMode !== 'custom',
                        render: (setting) => {
                            setting.setName('Resolved watch folder')
                                .setDesc(this.plugin.getOcrWatchFolder() || '(vault root)');
                        }
                    },
                    {
                        name: 'OCR output folder',
                        desc: 'Where to save OCR notes',
                        aliases: ['ocr output', 'ocr notes folder'],
                        visible: () => s.ocrEnabled,
                        control: {
                            type: 'dropdown', key: 'ocrOutputFolderMode',
                            options: {
                                'custom': 'A specific folder',
                                'source': 'Same folder as the source file',
                                'obsidian-settings': "Obsidian's attachment folder",
                                'vaultkeeper': "Vaultkeeper's organize destination"
                            }
                        }
                    },
                    {
                        name: 'Output folder path',
                        desc: 'Folder to save OCR notes into',
                        aliases: ['ocr output path'],
                        visible: () => s.ocrEnabled && s.ocrOutputFolderMode === 'custom',
                        control: { type: 'text', key: 'ocrOutputFolder', placeholder: 'assets/attachments/ocr' }
                    },
                    {
                        name: 'Output subfolder',
                        desc: 'Subfolder appended to the resolved output location. Leave empty to write notes directly there.',
                        aliases: ['ocr subfolder'],
                        visible: () => s.ocrEnabled && s.ocrOutputFolderMode !== 'custom',
                        control: { type: 'text', key: 'ocrOutputSubfolder', placeholder: 'ocr' }
                    },
                ],
            },
            // OCR Processing
            {
                type: 'group',
                heading: 'OCR Processing',
                visible: () => s.ocrEnabled,
                items: [
                    {
                        name: 'Batch size',
                        desc: 'Files processed per batch. 1 is recommended for the free tier.',
                        aliases: ['ocr batch', 'ocr processing batch'],
                        control: { type: 'slider', key: 'ocrBatchSize', min: 1, max: 5, step: 1 }
                    },
                    {
                        name: 'Max file size (MB)',
                        desc: 'Files larger than this will be skipped by OCR',
                        aliases: ['ocr max size', 'ocr file size limit'],
                        render: (setting) => {
                            setting.setName('Max file size (MB)').setDesc('Files larger than this will be skipped by OCR')
                                .addSlider(slider => slider
                                    .setLimits(1, 50, 1)
                                    .setValue(s.ocrMaxFileSize / 1024 / 1024)
                                    .setDynamicTooltip()
                                    .onChange(async (value) => {
                                        s.ocrMaxFileSize = value * 1024 * 1024;
                                        await save();
                                    }));
                        }
                    },
                    {
                        name: 'Force reprocess',
                        desc: 'Reprocess files even when OCR output already exists',
                        aliases: ['ocr force', 'reprocess ocr'],
                        control: { type: 'toggle', key: 'ocrForceReprocess' }
                    },
                    {
                        name: 'Auto-process new files',
                        desc: 'OCR new images and PDFs added to the watch folder',
                        aliases: ['ocr auto new', 'automatic ocr'],
                        control: { type: 'toggle', key: 'ocrAutoProcessNewFiles' }
                    },
                    {
                        name: 'Auto-process modified files',
                        desc: 'OCR files again when they are modified',
                        aliases: ['ocr auto modified'],
                        control: { type: 'toggle', key: 'ocrAutoProcessModifiedFiles' }
                    },
                    {
                        name: 'OCR processed field',
                        desc: 'Frontmatter field used to mark files as already processed',
                        aliases: ['ocr frontmatter', 'ocr field'],
                        control: { type: 'text', key: 'ocrProcessedField', placeholder: 'ocr-processed' }
                    },
                ],
            },
            // OCR Templates
            {
                type: 'group',
                heading: 'OCR Templates',
                visible: () => s.ocrEnabled,
                items: [
                    {
                        name: 'Note properties',
                        desc: 'Add YAML frontmatter properties to each OCR note',
                        aliases: ['frontmatter', 'ocr properties', 'yaml'],
                        control: { type: 'toggle', key: 'ocrFrontmatterEnabled' }
                    },
                    {
                        name: 'Properties',
                        desc: 'One "key: value" per line',
                        aliases: ['ocr frontmatter properties'],
                        visible: () => s.ocrFrontmatterEnabled,
                        render: (setting) => {
                            const frag = document.createDocumentFragment();
                            frag.appendText('One "key: value" per line, written as YAML frontmatter at the top of each OCR note. Tokens: ');
                            frag.createEl('code', { text: '{{filename}} {{basename}} {{path}} {{link}} {{date}} {{time}} {{datetime}} {{status}} {{provider}} {{model}}' });
                            frag.appendText('. The "OCR processed field" below is added automatically.');
                            setting.setName('Properties').setDesc(frag).setClass('setting-item-heading');
                            setting.settingEl.style.display = 'block';
                            const ta = setting.settingEl.createEl('textarea');
                            ta.placeholder = 'source: "[[{{path}}]]"\nprocessed: {{date}}\nstatus: {{status}}';
                            ta.value = s.ocrFrontmatterProperties;
                            ta.rows = 6;
                            ta.className = 'ocr-template-textarea';
                            ta.addEventListener('input', async (e) => {
                                s.ocrFrontmatterProperties = e.target.value;
                                await save();
                            });
                        }
                    },
                    {
                        name: 'OCR prompt',
                        desc: 'Prompt sent to the model when processing each file',
                        aliases: ['gemini prompt', 'ocr instruction'],
                        render: (setting) => {
                            setting.setName('OCR prompt').setDesc('Prompt sent to the model when processing each file')
                                .setClass('setting-item-heading');
                            setting.settingEl.style.display = 'block';
                            const ta = setting.settingEl.createEl('textarea');
                            ta.placeholder = 'Extract all text from this image/document...';
                            ta.value = s.ocrPrompt;
                            ta.rows = 8;
                            ta.className = 'ocr-template-textarea';
                            ta.addEventListener('input', async (e) => {
                                s.ocrPrompt = e.target.value;
                                await save();
                            });
                        }
                    },
                    {
                        name: 'OCR output template',
                        desc: 'Body of OCR notes. Variables: {{content}}, {{filename}}, {{basename}}, {{path}}, {{link}}, {{date}}, {{time}}, {{datetime}}, {{status}}, {{provider}}, {{model}}',
                        aliases: ['ocr template', 'ocr note template'],
                        render: (setting) => {
                            setting.setName('OCR output template')
                                .setDesc('Body of OCR notes. Variables: {{content}}, {{filename}}, {{basename}}, {{path}}, {{link}}, {{date}}, {{time}}, {{datetime}}, {{status}}, {{provider}}, {{model}}')
                                .setClass('setting-item-heading');
                            setting.settingEl.style.display = 'block';
                            const ta = setting.settingEl.createEl('textarea');
                            ta.placeholder = '# OCR Result for {{filename}}...';
                            ta.value = s.ocrTemplate;
                            ta.rows = 10;
                            ta.className = 'ocr-template-textarea';
                            ta.addEventListener('input', async (e) => {
                                s.ocrTemplate = e.target.value;
                                await save();
                            });
                        }
                    },
                ],
            },
        ];

        return defs;
    }

    display() {
        // Called after getSettingDefinitions() renders — wire up collapsible groups
        const { containerEl } = this;
        // Give the browser one tick to finish DOM insertion
        setTimeout(() => {
            containerEl.querySelectorAll('.setting-group').forEach(group => {
                const heading = group.querySelector('.setting-group-heading');
                if (!heading) return;
                if (heading.dataset.vkCollapsible) return; // already wired

                heading.dataset.vkCollapsible = '1';
                heading.style.cursor = 'pointer';
                heading.style.userSelect = 'none';

                // Arrow indicator
                const arrow = document.createElement('span');
                arrow.className = 'vk-group-arrow';
                arrow.textContent = ' ▾';
                heading.appendChild(arrow);

                let collapsed = false;
                heading.addEventListener('click', () => {
                    collapsed = !collapsed;
                    const items = group.querySelectorAll('.setting-item');
                    items.forEach(el => { el.style.display = collapsed ? 'none' : ''; });
                    arrow.textContent = collapsed ? ' ▸' : ' ▾';
                });
            });
        }, 0);
    }

    getControlValue(key) {
        return this.plugin.settings[key];
    }

    setControlValue(key, value) {
        this.plugin.settings[key] = value;
        return this.plugin.saveSettings();
    }

    createAccordionSection(containerEl, title, contentCallback) {
        const accordionContainer = containerEl.createDiv('accordion-section');
        
        const header = accordionContainer.createDiv('accordion-header');
        header.className = 'accordion-header';
        
        const headerText = header.createSpan();
        headerText.textContent = title;
        
        const arrow = header.createSpan('accordion-arrow');
        arrow.textContent = '▼';
        arrow.className = 'accordion-arrow';
        
        const content = accordionContainer.createDiv('accordion-content');
        content.className = 'accordion-content';
        
        let isExpanded = true; // Start expanded

        // Set initial state
        content.classList.add('expanded');
        arrow.classList.add('expanded');
        header.classList.add('expanded');
        
        const toggleAccordion = () => {
            isExpanded = !isExpanded;
            
            if (isExpanded) {
                content.classList.add('expanded');
                content.classList.remove('collapsed');
                arrow.classList.add('expanded');
                arrow.classList.remove('collapsed');
                header.classList.add('expanded');
                header.classList.remove('collapsed');
            } else {
                content.classList.add('collapsed');
                content.classList.remove('expanded');
                arrow.classList.add('collapsed');
                arrow.classList.remove('expanded');
                header.classList.add('collapsed');
                header.classList.remove('expanded');
            }
        };
        
        header.addEventListener('click', toggleAccordion);
        
        // Pass the content div directly so new Setting(el) appends into the accordion
        contentCallback(content);
    }
}


class OcrPickerModal extends Modal {
    constructor(app, files, onPick) {
        super(app);
        this.files = files;
        this.onPick = onPick;
        this.filterText = '';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'OCR: Pick attachment to process' });
        contentEl.createEl('p', { text: `${this.files.length} OCR-compatible file${this.files.length !== 1 ? 's' : ''} found in vault.`, cls: 'ao-purge-desc' });

        const input = contentEl.createEl('input', { type: 'text', placeholder: 'Filter by filename or path...' });
        input.style.cssText = 'width:100%;margin-bottom:10px;padding:6px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);';
        input.addEventListener('input', () => {
            this.filterText = input.value.trim().toLowerCase();
            this.renderList(listEl);
        });

        const listEl = contentEl.createDiv({ cls: 'ao-purge-list' });
        this.renderList(listEl);

        const btnRow = contentEl.createDiv({ cls: 'ao-purge-btn-row' });
        const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());
    }

    renderList(listEl) {
        listEl.empty();
        const filtered = this.filterText
            ? this.files.filter(f => f.path.toLowerCase().includes(this.filterText) || f.name.toLowerCase().includes(this.filterText))
            : this.files;

        if (filtered.length === 0) {
            listEl.createEl('p', { text: 'No matching files.', cls: 'ao-purge-desc' });
            return;
        }

        for (const file of filtered) {
            const row = listEl.createDiv({ cls: 'ao-purge-row' });
            row.style.cursor = 'pointer';
            const info = row.createDiv({ cls: 'ao-purge-label' });
            info.createEl('span', { text: file.name, cls: 'ao-purge-name' });
            info.createEl('span', { text: file.path, cls: 'ao-purge-path' });
            row.addEventListener('click', () => {
                this.close();
                this.onPick(file);
            });
            row.addEventListener('mouseenter', () => row.style.background = 'var(--background-modifier-hover)');
            row.addEventListener('mouseleave', () => row.style.background = '');
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

class PurgeUnlinkedModal extends Modal {
    constructor(app, unlinkedFiles, onConfirm) {
        super(app);
        this.unlinkedFiles = unlinkedFiles;
        this.onConfirm = onConfirm;
        this.selected = new Set(unlinkedFiles.map(f => f.path));
        this.confirmStep = false;
    }

    onOpen() {
        this.render();
    }

    render() {
        const { contentEl } = this;
        contentEl.empty();

        if (this.confirmStep) {
            this.renderConfirmStep();
        } else {
            this.renderSelectStep();
        }
    }

    renderSelectStep() {
        const { contentEl } = this;

        contentEl.createEl('h2', { text: 'Purge Unlinked Attachments' });
        contentEl.createEl('p', {
            text: `Found ${this.unlinkedFiles.length} unlinked attachment${this.unlinkedFiles.length !== 1 ? 's' : ''}. Select which ones to delete.`,
            cls: 'ao-purge-desc'
        });

        // Select all / none buttons
        const bulkRow = contentEl.createDiv({ cls: 'ao-purge-bulk-row' });
        const selectAllBtn = bulkRow.createEl('button', { text: 'Select All' });
        selectAllBtn.addEventListener('click', () => {
            this.selected = new Set(this.unlinkedFiles.map(f => f.path));
            this.render();
        });
        const selectNoneBtn = bulkRow.createEl('button', { text: 'Select None' });
        selectNoneBtn.addEventListener('click', () => {
            this.selected = new Set();
            this.render();
        });

        const countEl = bulkRow.createSpan({ cls: 'ao-purge-count' });
        countEl.setText(`${this.selected.size} of ${this.unlinkedFiles.length} selected`);

        // File list with checkboxes
        const listEl = contentEl.createDiv({ cls: 'ao-purge-list' });
        for (const file of this.unlinkedFiles) {
            const row = listEl.createDiv({ cls: 'ao-purge-row' });
            const checkbox = row.createEl('input', { type: 'checkbox' });
            checkbox.checked = this.selected.has(file.path);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selected.add(file.path);
                } else {
                    this.selected.delete(file.path);
                }
                countEl.setText(`${this.selected.size} of ${this.unlinkedFiles.length} selected`);
            });
            const label = row.createEl('label', { cls: 'ao-purge-label' });
            label.createEl('span', { text: file.name, cls: 'ao-purge-name' });
            label.createEl('span', { text: file.path, cls: 'ao-purge-path' });
            label.prepend(checkbox);
        }

        // Action buttons
        const btnRow = contentEl.createDiv({ cls: 'ao-purge-btn-row' });

        const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const deleteBtn = btnRow.createEl('button', { text: 'Delete Selected', cls: 'mod-warning' });
        deleteBtn.addEventListener('click', () => {
            if (this.selected.size === 0) {
                new Notice('No files selected.');
                return;
            }
            this.confirmStep = true;
            this.render();
        });
    }

    renderConfirmStep() {
        const { contentEl } = this;
        const filesToDelete = this.unlinkedFiles.filter(f => this.selected.has(f.path));

        contentEl.createEl('h2', { text: 'Confirm Deletion' });
        contentEl.createEl('p', {
            text: `You are about to permanently delete ${filesToDelete.length} file${filesToDelete.length !== 1 ? 's' : ''}. This cannot be undone.`,
            cls: 'ao-purge-warning'
        });

        const listEl = contentEl.createDiv({ cls: 'ao-purge-list ao-purge-confirm-list' });
        for (const file of filesToDelete) {
            const row = listEl.createDiv({ cls: 'ao-purge-row' });
            row.createEl('span', { text: '🗑 ', cls: 'ao-purge-icon' });
            const info = row.createDiv({ cls: 'ao-purge-label' });
            info.createEl('span', { text: file.name, cls: 'ao-purge-name' });
            info.createEl('span', { text: file.path, cls: 'ao-purge-path' });
        }

        const btnRow = contentEl.createDiv({ cls: 'ao-purge-btn-row' });

        const backBtn = btnRow.createEl('button', { text: '← Back' });
        backBtn.addEventListener('click', () => {
            this.confirmStep = false;
            this.render();
        });

        const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = btnRow.createEl('button', { text: `Delete ${filesToDelete.length} file${filesToDelete.length !== 1 ? 's' : ''}`, cls: 'mod-warning' });
        confirmBtn.addEventListener('click', async () => {
            this.close();
            await this.onConfirm(filesToDelete);
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

class PasteRenameModal extends Modal {
    constructor(app, file, suggestedName, onRename) {
        super(app);
        this.file = file;
        this.suggestedName = suggestedName;
        this.onRename = onRename;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Rename pasted file' });

        const originalExt = this.file.extension ? `.${this.file.extension}` : '';
        const baseName = this.suggestedName.replace(/\.[^.]+$/, '');

        contentEl.createEl('p', {
            text: `Original: ${this.file.name}`,
            cls: 'setting-item-description'
        });

        const inputRow = contentEl.createDiv({ cls: 'ao-rename-row' });
        const input = inputRow.createEl('input', { type: 'text', cls: 'ao-rename-input' });
        input.value = baseName;
        inputRow.createEl('span', { text: originalExt, cls: 'ao-rename-ext' });

        const btnRow = contentEl.createDiv({ cls: 'ao-purge-btn-row' });

        const cancelBtn = btnRow.createEl('button', { text: 'Keep original' });
        cancelBtn.addEventListener('click', () => {
            this.onRename(null);
            this.close();
        });

        const renameBtn = btnRow.createEl('button', { text: 'Rename', cls: 'mod-cta' });
        renameBtn.addEventListener('click', () => {
            const val = input.value.trim();
            if (val) {
                this.onRename(val + originalExt);
            } else {
                this.onRename(null);
            }
            this.close();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') renameBtn.click();
            if (e.key === 'Escape') cancelBtn.click();
        });

        setTimeout(() => { input.focus(); input.select(); }, 50);
    }

    onClose() {
        this.contentEl.empty();
    }
}

module.exports = class AttachmentOrganizer extends Plugin {
    async onload() {
        console.log('Loading Attachment Organizer plugin');
        
        // Initialize processing tracking
        this.processingFiles = new Set();
        this.processedFiles = new Set();
        this.fileWatchers = []; // Track active watchers for cleanup
        this.ocrStopRequested = false; // Flag to stop OCR processing
        
        await this.loadSettings();

        this.addSettingTab(new AttachmentOrganizerSettingTab(this.app, this));

        // Set up file watchers for automatic OCR processing with recursion prevention
        this.setupFileWatchers();

        // Paste rename watcher
        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file instanceof TFile) {
                    this.handlePastedFile(file);
                }
            })
        );

        // Auto-organize on load
        if (this.settings.organizeOnLoad) {
            this.app.workspace.onLayoutReady(() => this.organizeAttachments());
        }

        // Auto-organize on interval
        this.resetOrganizeInterval();

        this.addCommand({
            id: 'organize-attachments',
            name: 'Organize attachments',
            callback: () => this.organizeAttachments()
        });

        this.addCommand({
            id: 'find-unlinked-attachments',
            name: 'Find unlinked attachments',
            callback: () => this.findUnlinkedAttachments()
        });

        this.addCommand({
            id: 'purge-unlinked-attachments',
            name: 'Purge unlinked attachments',
            callback: () => this.purgeUnlinkedAttachments()
        });

        this.addCommand({
            id: 'move-attachments-between-folders',
            name: 'Move attachments between folders',
            callback: () => this.moveAttachmentsBetweenFolders()
        });

        // OCR Commands
        this.addCommand({
            id: 'ocr-watch-folder',
            name: 'OCR: Process watch folder',
            callback: () => this.ocrWatchFolder()
        });

        this.addCommand({
            id: 'ocr-reprocess-all',
            name: 'OCR: Reprocess all files (force update)',
            callback: () => this.ocrReprocessAll()
        });

        this.addCommand({
            id: 'ocr-current-file',
            name: 'OCR: Process current file',
            checkCallback: (checking) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && this.isOcrTarget(activeFile)) {
                    if (!checking) {
                        this.runOcrOnFile(activeFile);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'ocr-stop-processing',
            name: 'OCR: Stop processing',
            callback: () => this.stopOcrProcessing()
        });

        this.addCommand({
            id: 'ocr-pick-attachment',
            name: 'OCR: Pick attachment to process',
            callback: () => this.ocrPickAttachment()
        });

    }

    applyPasteRenamePattern(pattern, file) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const activeNote = this.app.workspace.getActiveFile();
        const tokens = {
            '{{year}}': now.getFullYear().toString(),
            '{{month}}': pad(now.getMonth() + 1),
            '{{day}}': pad(now.getDate()),
            '{{time}}': `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
            '{{type}}': file.extension?.toLowerCase() || 'file',
            '{{filename}}': activeNote?.basename || file.basename,
            '{{note}}': activeNote?.basename || file.basename,
            '{{original}}': file.basename,
        };
        let result = pattern;
        for (const [token, value] of Object.entries(tokens)) {
            result = result.replace(new RegExp(token.replace(/[{}]/g, '\\$&'), 'g'), value);
        }
        // Sanitize: remove characters not allowed in filenames
        return result.replace(/[\\/:*?"<>|]/g, '_');
    }

    async handlePastedFile(file) {
        const mode = this.settings.pasteRenameMode;
        if (mode === 'none') return;

        const attachmentExtensions = this.settings.attachmentExtensions
            .split(',').map(e => e.trim().toLowerCase());
        if (!attachmentExtensions.includes(file.extension?.toLowerCase())) return;

        // Skip files that already existed before this session started.
        // Obsidian fires 'create' for all indexed files on startup; genuine
        // pastes have a ctime within the last 10 seconds.
        const ageMs = Date.now() - (file.stat?.ctime ?? 0);
        if (ageMs > 10000) return;

        // Debounce: skip if already being renamed
        if (this._renamingFiles?.has(file.path)) return;
        if (!this._renamingFiles) this._renamingFiles = new Set();
        this._renamingFiles.add(file.path);

        // Delay to ensure Obsidian's metadata cache has indexed the file
        // before renameFile attempts to update backlinks in notes.
        await new Promise(r => setTimeout(r, 1000));

        // Re-check file still exists using fresh vault reference
        const current = this.app.vault.getAbstractFileByPath(file.path);
        if (!(current instanceof TFile)) {
            this._renamingFiles.delete(file.path);
            return;
        }

        const ext = current.extension ? `.${current.extension}` : '';
        // Prefer the active note's folder as destination so the renamed file
        // lands next to the note it was pasted into, not at vault root.
        const activeNote = this.app.workspace.getActiveFile();
        const noteFolder = activeNote?.parent?.path && activeNote.parent.path !== '/'
            ? activeNote.parent.path : '';
        const parentPath = current.parent?.path && current.parent.path !== '/'
            ? current.parent.path
            : noteFolder;

        const doRename = async (newName) => {
            if (!newName) { this._renamingFiles.delete(current.path); return; }
            const newPath = parentPath ? `${parentPath}/${newName}` : newName;
            if (newPath === current.path) { this._renamingFiles.delete(current.path); return; }
            const oldName = current.name;
            try {
                await this.app.fileManager.renameFile(current, newPath);
                // Manually patch the active editor — renameFile may not update
                // the link if the embed was just inserted and cache isn't ready.
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView?.editor) {
                    const editor = activeView.editor;
                    const before = editor.getValue();
                    const after = before.split(oldName).join(newName);
                    if (after !== before) {
                        const cursor = editor.getCursor();
                        editor.setValue(after);
                        editor.setCursor(cursor);
                    }
                }
            } catch (e) {
                new Notice(`Rename failed: ${e.message}`);
            }
            this._renamingFiles.delete(current.path);
        };

        if (mode === 'date') {
            const newName = this.applyPasteRenamePattern(this.settings.pasteRenameDateFormat, current) + ext;
            await doRename(newName);
        } else if (mode === 'custom') {
            const newName = this.applyPasteRenamePattern(this.settings.pasteRenameCustomPattern, current) + ext;
            await doRename(newName);
        } else if (mode === 'ask') {
            new PasteRenameModal(this.app, current, current.name, async (newName) => {
                await doRename(newName);
            }).open();
        } else if (mode === 'date-ask') {
            const suggested = this.applyPasteRenamePattern(this.settings.pasteRenameDateFormat, current) + ext;
            new PasteRenameModal(this.app, current, suggested, async (newName) => {
                await doRename(newName);
            }).open();
        } else {
            this._renamingFiles.delete(current.path);
        }
    }

    resetOrganizeInterval() {
        if (this._organizeIntervalId) {
            clearInterval(this._organizeIntervalId);
            this._organizeIntervalId = null;
        }
        if (this.settings.organizeInterval > 0) {
            const ms = this.settings.organizeInterval * 60 * 1000;
            this._organizeIntervalId = setInterval(() => this.organizeAttachments(), ms);
        }
    }

    async organizeAttachments(resolvedFolderName) {
        if (this.settings.organizationMode === 'separate-folder' && !resolvedFolderName) {
            resolvedFolderName = this.settings.separateFolderName || 'attachments';
        }

        const files = this.app.vault.getFiles();
        const attachmentExtensions = this.settings.attachmentExtensions.split(',').map(ext => ext.trim().toLowerCase());
        
        let organized = 0;
        let skipped = 0;

        for (const file of files) {
            if (!attachmentExtensions.includes(file.extension?.toLowerCase())) {
                continue;
            }

            const ignoreFolders = this.settings.ignoreFolders.split(',').map(f => f.trim()).filter(f => f);
            if (ignoreFolders.some(folder => file.path.startsWith(folder + '/'))) {
                skipped++;
                continue;
            }

            try {
                const newPath = this.getNewAttachmentPath(file, resolvedFolderName);
                if (newPath !== file.path) {
                    const oldFolder = file.parent?.path || '';
                    await this.ensureFolderExists(newPath.substring(0, newPath.lastIndexOf('/')));
                    await this.app.vault.rename(file, newPath);
                    organized++;
                    // Remove old folder (and empty ancestors) if now empty
                    if (oldFolder) {
                        await this.deleteIfEmpty(oldFolder);
                    }
                }
            } catch (error) {
                console.error(`Failed to organize ${file.path}:`, error);
                skipped++;
            }
        }

        new Notice(`Organized ${organized} attachments, skipped ${skipped}`);
    }

    // Raw value of Obsidian's "Default location for new attachments"
    // (Settings → Files and links). getConfig is the supported accessor and
    // works on desktop and mobile; vault.config is the older internal field.
    getObsidianAttachmentSetting() {
        let cfg;
        if (typeof this.app.vault.getConfig === 'function') {
            cfg = this.app.vault.getConfig('attachmentFolderPath');
        }
        if (cfg === undefined || cfg === null) {
            cfg = this.app.vault.config?.attachmentFolderPath;
        }
        return typeof cfg === 'string' ? cfg : '';
    }

    // Human-readable summary of the Obsidian setting, for the settings tab.
    describeObsidianAttachmentSetting() {
        const cfg = this.getObsidianAttachmentSetting();
        if (!cfg || cfg === '/') return 'Vault root (Obsidian setting: "Vault folder")';
        if (cfg === './') return 'Same folder as the note (Obsidian setting: "Same folder as current file")';
        if (cfg.startsWith('./')) return `Subfolder "${cfg.slice(2)}" under the note's folder (Obsidian setting: "In subfolder under current folder")`;
        return `"${cfg}" (Obsidian setting: "In the folder specified below")`;
    }

    // Resolve Obsidian's attachment folder setting to a concrete vault folder.
    // `noteFolder` is the folder of the note the attachment belongs to, used
    // for the two note-relative forms. Returns '' for the vault root.
    resolveObsidianAttachmentFolder(noteFolder) {
        const cfg = this.getObsidianAttachmentSetting().trim();
        const base = (noteFolder ?? '').replace(/^\/+|\/+$/g, '');

        // "Vault folder"
        if (!cfg || cfg === '/') return '';
        // "Same folder as current file"
        if (cfg === '.' || cfg === './') return base;
        // "In subfolder under current folder"
        if (cfg.startsWith('./')) {
            const sub = cfg.slice(2).replace(/^\/+|\/+$/g, '');
            if (!sub) return base;
            return base ? `${base}/${sub}` : sub;
        }
        // "In the folder specified below" — an absolute vault path
        return cfg.replace(/^\/+|\/+$/g, '');
    }

    // Folder of the first note that links to `file`, or null when nothing
    // links to it. '' is a valid result (note lives at the vault root).
    getLinkingNoteFolder(file) {
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        for (const [notePath, links] of Object.entries(resolvedLinks)) {
            if (links[file.path] === undefined) continue;
            const noteFile = this.app.vault.getAbstractFileByPath(notePath);
            if (noteFile instanceof TFile) {
                return noteFile.parent?.path ?? '';
            }
        }
        return null;
    }

    getNewAttachmentPath(file, resolvedFolderName) {
        let baseFolder;

        if (this.settings.organizationMode === 'obsidian-settings') {
            // Note-relative forms of the Obsidian setting need to know which
            // note owns the attachment. When nothing links to it there is no
            // correct answer, so leave the file alone rather than guessing.
            const cfg = this.getObsidianAttachmentSetting().trim();
            const isNoteRelative = !cfg || cfg === '.' || cfg.startsWith('./');
            let noteFolder = null;
            if (isNoteRelative && cfg !== '') {
                noteFolder = this.getLinkingNoteFolder(file);
                if (noteFolder === null) return file.path;
            }
            baseFolder = this.resolveObsidianAttachmentFolder(noteFolder ?? '');
        } else if (this.settings.organizationMode === 'same-location') {
            // Same folder as the note that links to the attachment — nothing
            // else. Subfolder sorting deliberately does not apply here, and an
            // attachment nothing links to stays exactly where it is instead of
            // being swept into a folder at the vault root.
            const linkingNoteFolder = this.getLinkingNoteFolder(file);
            if (linkingNoteFolder === null) return file.path;
            return linkingNoteFolder ? `${linkingNoteFolder}/${file.name}` : file.name;
        } else {
            // separate-folder: use the resolved (prompted) folder name
            baseFolder = resolvedFolderName || this.settings.separateFolderName || 'attachments';
        }

        // Compute the subfolder suffix independently so we can detect already-organized files.
        let subfolderSuffix = '';
        if (this.settings.autoOrganizeMode === 'date') {
            const date = new Date(file.stat?.mtime || Date.now());
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            subfolderSuffix = `${year}/${month}`;
        } else if (this.settings.autoOrganizeMode === 'type') {
            subfolderSuffix = file.extension?.toLowerCase() || 'unknown';
        } else if (this.settings.autoOrganizeMode === 'custom' && this.settings.customPattern) {
            const date = new Date(file.stat?.mtime || Date.now());
            const replacements = {
                '{{type}}': file.extension?.toLowerCase() || 'unknown',
                '{{year}}': date.getFullYear().toString(),
                '{{month}}': String(date.getMonth() + 1).padStart(2, '0'),
                '{{day}}': String(date.getDate()).padStart(2, '0'),
                '{{filename}}': file.basename
            };
            let pattern = this.settings.customPattern;
            for (const [placeholder, value] of Object.entries(replacements)) {
                pattern = pattern.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
            }
            subfolderSuffix = pattern;
        }

        if (subfolderSuffix) {
            baseFolder = baseFolder ? `${baseFolder}/${subfolderSuffix}` : subfolderSuffix;
        }

        // Build new path, avoiding double slashes
        const newPath = baseFolder ? `${baseFolder}/${file.name}` : file.name;

        // If the file is already in the correct location, skip the move.
        const currentFolder = file.parent?.path || '';
        if (currentFolder === baseFolder) {
            return file.path;
        }
        // Also skip if the current path already ends with the full target baseFolder
        // (catches cases where the path was partially nested before)
        if (baseFolder && currentFolder.endsWith('/' + baseFolder)) {
            return file.path;
        }
        // Never re-nest: if the current folder already matches the organized
        // layout and the target would push the file deeper inside its own
        // folder, it's already organized (e.g. the "linking note" found is an
        // OCR note living inside the organized folder).
        if (baseFolder.startsWith(currentFolder + '/')) {
            const suffixSrc = this.getOrganizedSuffixRegexSource();
            if (suffixSrc && new RegExp(`(?:^|/)${suffixSrc}$`).test(currentFolder)) {
                return file.path;
            }
        }

        return newPath;
    }

    // Regex source matching the subfolder layout the current settings would
    // generate, with date/type/filename tokens widened to wildcards so it
    // matches regardless of when a file was organized. Null when no
    // subfolder sorting is configured.
    getOrganizedSuffixRegexSource() {
        const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const mode = this.settings.autoOrganizeMode;
        if (mode === 'date') {
            return '\\d{4}/\\d{2}';
        }
        if (mode === 'type') {
            const exts = this.settings.attachmentExtensions
                .split(',').map(e => e.trim().toLowerCase()).filter(Boolean).map(escape);
            return `(?:${['unknown', ...exts].join('|')})`;
        }
        if (mode === 'custom' && this.settings.customPattern) {
            return escape(this.settings.customPattern)
                .replace(/\\\{\\\{year\\\}\\\}/g, '\\d{4}')
                .replace(/\\\{\\\{month\\\}\\\}/g, '\\d{2}')
                .replace(/\\\{\\\{day\\\}\\\}/g, '\\d{2}')
                .replace(/\\\{\\\{type\\\}\\\}/g, '[^/]+')
                .replace(/\\\{\\\{filename\\\}\\\}/g, '[^/]+');
        }
        return null;
    }

    // Remove trailing organized-subfolder segments from a folder path so the
    // pattern is applied to the file's true base folder. Without this, using
    // the file's own folder as the base re-appends the pattern on every run
    // and nests it forever (e.g. Games/[attachments]/2026/05/[attachments]/2026/05).
    stripOrganizedSuffix(folderPath) {
        const suffixSrc = this.getOrganizedSuffixRegexSource();
        if (!suffixSrc || !folderPath) return folderPath;
        const re = new RegExp(`(?:^|/)${suffixSrc}$`);
        let stripped = folderPath;
        while (re.test(stripped)) {
            stripped = stripped.replace(re, '');
        }
        return stripped;
    }

    async findUnlinkedAttachments() {
        const files = this.app.vault.getFiles();
        const attachmentExtensions = this.settings.attachmentExtensions.split(',').map(ext => ext.trim().toLowerCase());
        const attachments = files.filter(file => attachmentExtensions.includes(file.extension?.toLowerCase()));
        
        const linkedAttachments = new Set();
        const markdownFiles = files.filter(file => file.extension === 'md');

        for (const mdFile of markdownFiles) {
            const content = await this.app.vault.read(mdFile);
            const linkRegex = /\[\[([^\]]+)\]\]|!\[\[([^\]]+)\]\]/g;
            let match;
            
            while ((match = linkRegex.exec(content)) !== null) {
                const linkedFile = match[1] || match[2];
                const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(linkedFile, mdFile.path);
                if (resolvedFile) {
                    linkedAttachments.add(resolvedFile.path);
                }
            }
        }

        const unlinkedAttachments = attachments.filter(file => !linkedAttachments.has(file.path));
        
        if (unlinkedAttachments.length === 0) {
            new Notice('No unlinked attachments found');
            return;
        }

        const list = unlinkedAttachments.map(file => `- ${file.path}`).join('\n');
        const content = `# Unlinked Attachments\n\nFound ${unlinkedAttachments.length} unlinked attachments:\n\n${list}`;
        
        await this.app.workspace.openLinkText('Unlinked Attachments Report', '', true);
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
            activeView.editor.setValue(content);
        }
    }

    async getUnlinkedAttachments() {
        const files = this.app.vault.getFiles();
        const attachmentExtensions = this.settings.attachmentExtensions.split(',').map(ext => ext.trim().toLowerCase());
        const attachments = files.filter(file => attachmentExtensions.includes(file.extension?.toLowerCase()));

        const ignoreFolders = this.settings.ignoreFolders.split(',').map(f => f.trim()).filter(f => f);

        const linkedAttachments = new Set();
        const markdownFiles = files.filter(file => file.extension === 'md');

        for (const mdFile of markdownFiles) {
            const resolvedLinks = this.app.metadataCache.resolvedLinks[mdFile.path] || {};
            for (const destPath of Object.keys(resolvedLinks)) {
                linkedAttachments.add(destPath);
            }
        }

        return attachments.filter(file => {
            if (linkedAttachments.has(file.path)) return false;
            if (ignoreFolders.some(folder => file.path.startsWith(folder + '/'))) return false;
            return true;
        });
    }

    async purgeUnlinkedAttachments() {
        new Notice('Scanning for unlinked attachments...');
        const unlinked = await this.getUnlinkedAttachments();

        if (unlinked.length === 0) {
            new Notice('No unlinked attachments found.');
            return;
        }

        new PurgeUnlinkedModal(this.app, unlinked, async (filesToDelete) => {
            let deleted = 0;
            let failed = 0;
            for (const file of filesToDelete) {
                try {
                    await this.app.vault.trash(file, true);
                    deleted++;
                } catch (error) {
                    console.error(`Failed to delete ${file.path}:`, error);
                    failed++;
                }
            }
            let msg = `Deleted ${deleted} unlinked attachment${deleted !== 1 ? 's' : ''}.`;
            if (failed > 0) msg += ` ${failed} failed — check console.`;
            new Notice(msg);
        }).open();
    }

    async ocrPickAttachment() {
        if (!(await this.isOcrConfigured())) {
            new Notice(this.ocrConfigError(), 10000);
            return;
        }
        const targets = this.app.vault.getFiles().filter(f => this.isOcrTarget(f));
        if (targets.length === 0) {
            new Notice('No OCR-compatible files found in vault (images/PDFs).');
            return;
        }
        new OcrPickerModal(this.app, targets, async (file) => {
            const ocrPath = this.getOcrNotePath(file);
            const alreadyExists = await this.app.vault.adapter.exists(ocrPath);
            if (alreadyExists && !this.settings.ocrForceReprocess) {
                new Notice(`OCR note already exists for ${file.name}. Enable "Force reprocess" in settings to overwrite.`);
                return;
            }
            // Picked explicitly, so bypass the watch-folder restriction.
            await this.runOcrOnFile(file);
        }).open();
    }

    // OCR a single file regardless of the watch folder, with its own notice.
    async runOcrOnFile(file) {
        if (!(await this.isOcrConfigured())) {
            new Notice(this.ocrConfigError(), 10000);
            return;
        }
        const progress = this.startOcrProgress(`Running OCR on ${file.name} via ${this.getOcrProviderLabel()}...`);
        try {
            await this.ensureFolderExists(this.getOcrOutputFolder(file));
            const fileBuffer = await this.app.vault.readBinary(file);
            const mimeType = this.getMimeType(file.extension);
            if (!mimeType) throw new Error(`Unsupported file type: .${file.extension}`);
            const extractedText = await this.callOcrProvider(fileBuffer, mimeType, progress);
            const noteContent = this.buildOcrNote(file, extractedText, 'completed');
            const ocrPath = this.getOcrNotePath(file);
            const existing = this.app.vault.getAbstractFileByPath(ocrPath);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, noteContent);
            } else {
                await this.app.vault.create(ocrPath, noteContent);
            }
            progress.done(`OCR complete: ${file.name}`);
        } catch (error) {
            console.error('OCR error:', error);
            progress.done(`OCR failed for ${file.name}: ${error.message}`, 10000);
        }
    }

    async moveAttachmentsBetweenFolders() {
        new Notice('Move attachments feature not yet implemented');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async deleteIfEmpty(folderPath) {
        if (!folderPath || folderPath === '/') return;
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return;
        // Check if folder has any children left
        if (folder.children && folder.children.length > 0) return;
        try {
            await this.app.vault.delete(folder, true);
            // Walk up and delete parent if also now empty
            const parentPath = folderPath.includes('/')
                ? folderPath.substring(0, folderPath.lastIndexOf('/'))
                : '';
            if (parentPath) {
                await this.deleteIfEmpty(parentPath);
            }
        } catch (e) {
            // Ignore errors (e.g. folder not actually empty on disk)
        }
    }

    async ensureFolderExists(folder) {
        if (!folder) return;
        const existingFile = this.app.vault.getAbstractFileByPath(folder);
        if (existingFile instanceof TFolder) return;
        if (existingFile) throw new Error(`Path exists but is not a folder: ${folder}`);
        try {
            await this.app.vault.createFolder(folder);
        } catch (e) {
            // Ignore "already exists" — vault cache may be stale
            if (!e.message?.includes('already exists')) throw e;
        }
    }

    // OCR Helper Functions
    isOcrTarget(file) {
        if (!file || !file.extension) return false;
        const ext = file.extension.toLowerCase();
        return ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'gif', 'bmp', 'heic', 'heif'].includes(ext);
    }

    getMimeType(extension) {
        const ext = extension.toLowerCase();
        if (ext === 'pdf') return 'application/pdf';
        if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
            return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        }
        if (['tif', 'tiff'].includes(ext)) return 'image/tiff';
        if (['heic', 'heif'].includes(ext)) return 'image/heic';
        return null;
    }

    // Where Vaultkeeper's own "Organization" settings would put an attachment.
    // Used by the OCR folder settings so OCR notes can follow the same layout.
    // `sourceFile` is optional — without one, note-relative modes fall back to
    // the vault root so the setting still has a previewable value.
    getVaultkeeperOrganizeFolder(sourceFile) {
        const mode = this.settings.organizationMode;
        let base;
        if (mode === 'obsidian-settings') {
            const noteFolder = sourceFile ? this.getLinkingNoteFolder(sourceFile) : null;
            base = this.resolveObsidianAttachmentFolder(noteFolder ?? (sourceFile?.parent?.path || ''));
        } else if (mode === 'same-location') {
            const noteFolder = sourceFile ? this.getLinkingNoteFolder(sourceFile) : null;
            return noteFolder ?? this.stripOrganizedSuffix(sourceFile?.parent?.path || '');
        } else {
            base = this.settings.separateFolderName || 'attachments';
        }

        // Apply subfolder sorting (autoOrganizeMode)
        const suffix = this.getSubfolderSuffix(sourceFile);
        if (suffix) base = base ? `${base}/${suffix}` : suffix;
        return base;
    }

    // Subfolder segment the current "Sort into subfolders by" setting produces.
    getSubfolderSuffix(sourceFile) {
        const date = new Date(sourceFile?.stat?.mtime || Date.now());
        if (this.settings.autoOrganizeMode === 'date') {
            return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        if (this.settings.autoOrganizeMode === 'type') {
            return sourceFile?.extension?.toLowerCase() || 'unknown';
        }
        if (this.settings.autoOrganizeMode === 'custom' && this.settings.customPattern) {
            const replacements = {
                '{{type}}': sourceFile?.extension?.toLowerCase() || 'unknown',
                '{{year}}': date.getFullYear().toString(),
                '{{month}}': String(date.getMonth() + 1).padStart(2, '0'),
                '{{day}}': String(date.getDate()).padStart(2, '0'),
                '{{filename}}': sourceFile?.basename || ''
            };
            let pattern = this.settings.customPattern;
            for (const [placeholder, value] of Object.entries(replacements)) {
                pattern = pattern.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
            }
            return pattern;
        }
        return '';
    }

    // Folder monitored for OCR-able attachments. '' means the whole vault.
    getOcrWatchFolder() {
        const trim = (p) => (p || '').replace(/^\/+|\/+$/g, '');
        switch (this.settings.ocrWatchFolderMode) {
            case 'obsidian-settings':
                return trim(this.resolveObsidianAttachmentFolder(''));
            case 'vaultkeeper':
                return trim(this.getVaultkeeperOrganizeFolder(null));
            default:
                return trim(this.settings.ocrWatchFolder);
        }
    }

    isInOcrWatchFolder(file) {
        const watchFolder = this.getOcrWatchFolder();
        // Empty watch folder = watch the entire vault.
        if (!watchFolder) return true;
        return file.path.startsWith(watchFolder + '/') || file.path === watchFolder;
    }

    getOcrOutputFolder(sourceFile) {
        const trim = (p) => (p || '').replace(/^\/+|\/+$/g, '');
        const mode = this.settings.ocrOutputFolderMode;

        // A specific folder — used verbatim, no subfolder appended.
        if (mode === 'custom') return trim(this.settings.ocrOutputFolder);

        let base;
        if (mode === 'source') {
            base = trim(sourceFile?.parent?.path || '');
        } else if (mode === 'obsidian-settings') {
            const noteFolder = sourceFile ? this.getLinkingNoteFolder(sourceFile) : null;
            base = trim(this.resolveObsidianAttachmentFolder(noteFolder ?? (sourceFile?.parent?.path || '')));
        } else {
            base = trim(this.getVaultkeeperOrganizeFolder(sourceFile));
        }

        const sub = trim(this.settings.ocrOutputSubfolder);
        if (!sub) return base;
        return base ? `${base}/${sub}` : sub;
    }

    getOcrNotePath(sourceFile) {
        const folder = this.getOcrOutputFolder(sourceFile);
        const name = `${sourceFile.basename} (OCR).md`;
        return folder ? `${folder}/${name}` : name;
    }

    // Tokens available in both the frontmatter properties and the body template.
    getOcrTokens(sourceFile, status) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        return {
            '{{filename}}': sourceFile.name,
            '{{basename}}': sourceFile.basename,
            '{{path}}': sourceFile.path,
            '{{link}}': `[[${sourceFile.path}]]`,
            '{{date}}': dateStr,
            '{{time}}': timeStr,
            '{{datetime}}': `${dateStr} ${timeStr}`,
            '{{status}}': status,
            '{{provider}}': this.settings.ocrProvider,
            '{{model}}': this.getOcrModelName(),
        };
    }

    applyOcrTokens(text, tokens) {
        let result = text;
        for (const [token, value] of Object.entries(tokens)) {
            result = result.split(token).join(value ?? '');
        }
        return result;
    }

    // User-defined YAML frontmatter, plus the processed-marker field.
    buildOcrFrontmatter(tokens) {
        const lines = [];

        if (this.settings.ocrFrontmatterEnabled) {
            const raw = this.applyOcrTokens(this.settings.ocrFrontmatterProperties || '', tokens);
            for (const line of raw.split('\n')) {
                const trimmed = line.trim();
                // Blank lines and comments are dropped; list continuations
                // ("  - item") are kept as-is so multi-value properties work.
                if (!trimmed || trimmed.startsWith('#')) continue;
                if (trimmed.startsWith('-')) { lines.push(line.replace(/\s+$/, '')); continue; }
                if (!/^[^:]+:/.test(trimmed)) {
                    console.warn(`Vaultkeeper: skipping malformed OCR property line: ${line}`);
                    continue;
                }
                lines.push(trimmed);
            }
        }

        const field = (this.settings.ocrProcessedField || '').trim();
        if (field && !lines.some(l => l.startsWith(`${field}:`))) {
            lines.push(`${field}: true`);
        }

        if (lines.length === 0) return '';
        return `---\n${lines.join('\n')}\n---\n\n`;
    }

    buildOcrNote(sourceFile, extractedText, status = 'completed') {
        const tokens = this.getOcrTokens(sourceFile, status);
        const template = this.settings.ocrTemplate || '# OCR Result for {{filename}}\n\n## Extracted Text\n\n{{content}}';
        const body = this.applyOcrTokens(template, tokens)
            .split('{{content}}').join(extractedText);
        return this.buildOcrFrontmatter(tokens) + body;
    }

    // --- OCR providers ---------------------------------------------------

    getOcrModelName() {
        switch (this.settings.ocrProvider) {
            case 'openai': return this.settings.ocrOpenAiModel;
            case 'anthropic': return this.settings.ocrAnthropicModel;
            case 'gemini': return this.settings.ocrModel;
            default: return this.settings.ocrCustomModel;
        }
    }

    getOcrProviderLabel() {
        switch (this.settings.ocrProvider) {
            case 'openai': return 'OpenAI';
            case 'anthropic': return 'Anthropic';
            case 'gemini': return 'Gemini';
            default: return 'custom server';
        }
    }

    async getOcrApiKey() {
        const nameByProvider = {
            openai: this.settings.ocrOpenAiApiKeyName,
            anthropic: this.settings.ocrAnthropicApiKeyName,
            gemini: this.settings.ocrApiKeyName,
            custom: this.settings.ocrCustomApiKeyName,
        };
        const name = nameByProvider[this.settings.ocrProvider];
        if (!name) return null;
        return await this.app.secretStorage.get(name);
    }

    // True when the current provider has everything it needs to run.
    async isOcrConfigured() {
        if (!this.settings.ocrEnabled) return false;
        if (this.settings.ocrProvider === 'custom') {
            // A local server usually needs no key — a URL and model is enough.
            return !!(this.settings.ocrCustomBaseUrl && this.settings.ocrCustomModel);
        }
        return !!(await this.getOcrApiKey());
    }

    ocrConfigError() {
        if (!this.settings.ocrEnabled) return 'OCR is disabled. Enable it in Vaultkeeper settings.';
        if (this.settings.ocrProvider === 'custom') {
            return 'Custom OCR server is not configured. Set a base URL and model in Vaultkeeper settings.';
        }
        return `${this.getOcrProviderLabel()} API key is not configured. Set a secret in Vaultkeeper settings.`;
    }

    // ArrayBuffer -> base64, chunked to avoid blowing the call stack on
    // large files.
    arrayBufferToBase64(fileBuffer) {
        const bytes = new Uint8Array(fileBuffer);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    // Dispatches to the configured provider. `progress` is the handle from
    // startOcrProgress(), used to keep the notice alive during retries.
    async callOcrProvider(fileBuffer, mimeType, progress = null) {
        switch (this.settings.ocrProvider) {
            case 'openai': return await this.callOpenAiOCR(fileBuffer, mimeType);
            case 'anthropic': return await this.callAnthropicOCR(fileBuffer, mimeType);
            case 'gemini': return await this.callGeminiOCR(fileBuffer, mimeType, 0, progress);
            default: return await this.callCustomOCR(fileBuffer, mimeType);
        }
    }

    get ocrPromptText() {
        return this.settings.ocrPrompt || 'Extract all text from this image/document. Provide the text content clearly and accurately.';
    }

    // OpenAI-compatible chat completions — used for both OpenAI itself and
    // any self-hosted server that speaks the same API (Ollama, LM Studio,
    // vLLM, llama.cpp, LiteLLM, ...).
    async callOpenAiCompatibleOCR({ baseUrl, model, apiKey, fileBuffer, mimeType, timeoutSeconds }) {
        if (mimeType === 'application/pdf') {
            throw new Error('PDFs are not supported by this provider. Use Gemini or Anthropic for PDFs, or convert the page to an image first.');
        }
        const base64String = this.arrayBufferToBase64(fileBuffer);
        const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const body = {
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: this.ocrPromptText },
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64String}` } }
                ]
            }]
        };

        const response = await this.ocrRequest(url, headers, body, timeoutSeconds);
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`${this.getOcrProviderLabel()} error ${response.status}: ${response.text}`);
        }
        const result = response.json;
        const text = result?.choices?.[0]?.message?.content;
        if (typeof text !== 'string') {
            throw new Error(`Unexpected response from ${this.getOcrProviderLabel()}: ${response.text?.slice(0, 300)}`);
        }
        return text.trim();
    }

    async callOpenAiOCR(fileBuffer, mimeType) {
        const apiKey = await this.getOcrApiKey();
        if (!apiKey) throw new Error('OpenAI API key not configured. Set a secret in OCR settings.');
        return await this.callOpenAiCompatibleOCR({
            baseUrl: 'https://api.openai.com/v1',
            model: this.settings.ocrOpenAiModel,
            apiKey,
            fileBuffer,
            mimeType,
            timeoutSeconds: 180,
        });
    }

    async callCustomOCR(fileBuffer, mimeType) {
        const baseUrl = (this.settings.ocrCustomBaseUrl || '').trim();
        if (!baseUrl) throw new Error('Custom server base URL is not set.');
        if (!this.settings.ocrCustomModel) throw new Error('Custom server model is not set.');
        return await this.callOpenAiCompatibleOCR({
            baseUrl,
            model: this.settings.ocrCustomModel,
            apiKey: await this.getOcrApiKey(),
            fileBuffer,
            mimeType,
            timeoutSeconds: this.settings.ocrCustomTimeout || 600,
        });
    }

    async callAnthropicOCR(fileBuffer, mimeType) {
        const apiKey = await this.getOcrApiKey();
        if (!apiKey) throw new Error('Anthropic API key not configured. Set a secret in OCR settings.');

        const base64String = this.arrayBufferToBase64(fileBuffer);
        const block = mimeType === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64String } }
            : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64String } };

        const body = {
            model: this.settings.ocrAnthropicModel,
            max_tokens: 8192,
            messages: [{ role: 'user', content: [block, { type: 'text', text: this.ocrPromptText }] }]
        };
        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            // Required for browser-context requests such as Obsidian's.
            'anthropic-dangerous-direct-browser-access': 'true',
        };

        const response = await this.ocrRequest('https://api.anthropic.com/v1/messages', headers, body, 180);
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Anthropic API error ${response.status}: ${response.text}`);
        }
        const text = response.json?.content?.find(c => c.type === 'text')?.text;
        if (typeof text !== 'string') {
            throw new Error(`Unexpected response from Anthropic: ${response.text?.slice(0, 300)}`);
        }
        return text.trim();
    }

    // requestUrl bypasses the renderer's CORS checks, which browsers apply to
    // localhost servers (Ollama) and to api.anthropic.com alike. The timeout
    // is enforced here because requestUrl has none of its own.
    async ocrRequest(url, headers, body, timeoutSeconds) {
        const request = requestUrl({
            url,
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            throw: false,
        });
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`Request timed out after ${timeoutSeconds}s. Raise the timeout in settings if the model is just slow.`)),
                timeoutSeconds * 1000
            );
        });
        try {
            return await Promise.race([request, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    async testCustomOcrServer() {
        const baseUrl = (this.settings.ocrCustomBaseUrl || '').trim().replace(/\/+$/, '');
        if (!baseUrl) { new Notice('Set a base URL first.'); return; }
        const notice = new Notice(`Contacting ${baseUrl}...`, 0);
        try {
            const apiKey = await this.getOcrApiKey();
            const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
            const res = await requestUrl({ url: `${baseUrl}/models`, method: 'GET', headers, throw: false });
            if (res.status < 200 || res.status >= 300) {
                notice.setMessage(`Server responded ${res.status}: ${res.text?.slice(0, 200)}`);
                setTimeout(() => notice.hide(), 8000);
                return;
            }
            const ids = (res.json?.data || []).map(m => m.id);
            const wanted = this.settings.ocrCustomModel;
            const found = ids.includes(wanted);
            notice.setMessage(
                found
                    ? `Connected. Model "${wanted}" is available.`
                    : `Connected, but "${wanted}" was not listed. Available: ${ids.join(', ') || '(none)'}`
            );
            setTimeout(() => notice.hide(), 10000);
        } catch (e) {
            notice.setMessage(`Could not reach ${baseUrl}: ${e.message}`);
            setTimeout(() => notice.hide(), 10000);
        }
    }

    async callGeminiOCR(fileBuffer, mimeType, retryCount = 0, progress = null) {
        const apiKey = await this.getOcrApiKey();
        const model = this.settings.ocrModel;
        const prompt = this.ocrPromptText;

        if (!apiKey) {
            throw new Error('Gemini API key not configured. Set a secret in OCR Settings.');
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const base64String = this.arrayBufferToBase64(fileBuffer);

        const requestBody = {
            contents: [{
                parts: [
                    {
                        text: prompt
                    },
                    {
                        inline_data: {
                            mime_type: mimeType,
                            data: base64String
                        }
                    }
                ]
            }]
        };

        try {
            const response = await this.ocrRequest(url, { 'Content-Type': 'application/json' }, requestBody, 180);

            if (response.status < 200 || response.status >= 300) {
                const errorText = response.text;
                console.error('Gemini API Error Details:', {
                    status: response.status,
                    responseText: errorText,
                    model: model,
                    retryCount: retryCount
                });

                if (response.status === 429) {
                    // Parse retry delay from error response
                    let retryDelay = 30; // Default 30 seconds
                    try {
                        const errorData = JSON.parse(errorText);
                        if (errorData.error?.details) {
                            const retryInfo = errorData.error.details.find(d => d['@type']?.includes('RetryInfo'));
                            if (retryInfo?.retryDelay) {
                                retryDelay = parseInt(retryInfo.retryDelay.replace('s', '')) || 30;
                            }
                        }
                    } catch (e) {
                        // Ignore parsing errors, use default delay
                    }

                    // Implement exponential backoff with max 3 retries
                    if (retryCount < 3) {
                        const backoffDelay = Math.min(retryDelay * Math.pow(2, retryCount), 300); // Max 5 minutes
                        const msg = `Rate limit hit. Retrying in ${backoffDelay} seconds... (attempt ${retryCount + 1}/3)`;
                        if (progress) progress.setMessage(msg); else new Notice(msg);

                        await new Promise(resolve => setTimeout(resolve, backoffDelay * 1000));
                        return await this.callGeminiOCR(fileBuffer, mimeType, retryCount + 1, progress);
                    } else {
                        new Notice('Gemini API quota exceeded. Try again later or switch to gemini-1.5-flash model.');
                        throw new Error(`API_ERROR_429: Rate limit exceeded after ${retryCount} retries. ${errorText}`);
                    }
                }
                throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
            }

            const result = response.json;

            if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
                throw new Error('Invalid response from Gemini API');
            }

            return result.candidates[0].content.parts[0].text.trim();
        } catch (error) {
            if (error.message.includes('API_ERROR_429')) {
                throw error; // Re-throw 429 errors as-is
            }
            throw new Error(`Network or API error: ${error.message}`);
        }
    }

    // A Notice with no timeout, so it stays on screen for the whole run —
    // local models in particular can take minutes. Callers must call done()
    // (or fail()) in a finally block. An elapsed-seconds counter ticks so it
    // is obvious the run has not silently stalled.
    startOcrProgress(message) {
        const notice = new Notice('', 0);
        const startedAt = Date.now();
        let label = message;
        let finished = false;

        const paint = () => {
            const secs = Math.floor((Date.now() - startedAt) / 1000);
            const mins = Math.floor(secs / 60);
            const elapsed = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
            notice.setMessage(`${label} (${elapsed})`);
        };
        paint();
        const timer = window.setInterval(paint, 1000);
        this.registerInterval(timer);

        const stop = () => {
            if (finished) return;
            finished = true;
            window.clearInterval(timer);
        };

        return {
            setMessage: (msg) => { label = msg; paint(); },
            // Replace the notice with a final message that fades on its own.
            done: (msg, timeoutMs = 5000) => {
                stop();
                if (msg) {
                    notice.setMessage(msg);
                    window.setTimeout(() => notice.hide(), timeoutMs);
                } else {
                    notice.hide();
                }
            },
            // No-op once done() has run, so a finally-block hide() does not
            // yank the final message off screen.
            hide: () => { if (finished) return; stop(); notice.hide(); },
        };
    }

    // Runs OCR on one file and writes the note. `progress` is an existing
    // progress handle to reuse (batch runs share one notice); when omitted a
    // notice is created and closed here.
    async processFileForOcr(file, progress = null) {
        if (!(await this.isOcrConfigured())) {
            return;
        }

        const ownsProgress = !progress;
        try {
            if (!this.isInOcrWatchFolder(file)) {
                return;
            }

            // Check if it's a target file type
            if (!this.isOcrTarget(file)) {
                return;
            }

            const ocrPath = this.getOcrNotePath(file);
            const alreadyExists = await this.app.vault.adapter.exists(ocrPath);
            if (alreadyExists && !this.settings.ocrForceReprocess) {
                return;
            }

            if (ownsProgress) {
                progress = this.startOcrProgress(`Running OCR on ${file.name} via ${this.getOcrProviderLabel()}...`);
            } else {
                progress.setMessage(`Running OCR on ${file.name} via ${this.getOcrProviderLabel()}...`);
            }

            await this.ensureFolderExists(this.getOcrOutputFolder(file));

            const fileBuffer = await this.app.vault.readBinary(file);
            const mimeType = this.getMimeType(file.extension);
            const extractedText = await this.callOcrProvider(fileBuffer, mimeType, progress);

            const noteContent = this.buildOcrNote(file, extractedText, 'completed');
            const existing = this.app.vault.getAbstractFileByPath(ocrPath);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, noteContent);
            } else {
                await this.app.vault.create(ocrPath, noteContent);
            }

            if (ownsProgress) progress.done(`OCR complete: ${file.name}`);
        } catch (error) {
            console.error('OCR processing error:', error);
            if (progress && ownsProgress) {
                progress.done(`OCR failed for ${file.name}: ${error.message}`, 10000);
            } else {
                new Notice(`OCR failed for ${file.name}: ${error.message}`, 10000);
            }
            if (!ownsProgress) throw error;
        }
    }

    async ocrWatchFolder() {
        if (!(await this.isOcrConfigured())) {
            new Notice(this.ocrConfigError(), 10000);
            return;
        }

        // Reset stop flag
        this.ocrStopRequested = false;

        let files = this.app.vault.getFiles().filter(f =>
            this.isInOcrWatchFolder(f) && this.isOcrTarget(f) && !this.isOcrOutputFile(f)
        );

        if (files.length === 0) {
            new Notice('No images or PDFs found in watch folder');
            return;
        }

        // Filter files by size and existing OCR status
        const validFiles = [];
        for (const file of files) {
            const stat = await this.app.vault.adapter.stat(file.path);
            if (stat.size > this.settings.ocrMaxFileSize) {
                console.warn(`Skipping ${file.name}: file too large (${(stat.size / 1024 / 1024).toFixed(2)}MB)`);
                continue;
            }

            const ocrPath = this.getOcrNotePath(file);
            const ocrExists = await this.app.vault.adapter.exists(ocrPath);
            
            if (!ocrExists || this.settings.ocrForceReprocess) {
                // Check if file was modified after OCR
                if (ocrExists && !this.settings.ocrForceReprocess) {
                    const ocrStat = await this.app.vault.adapter.stat(ocrPath);
                    if (stat.mtime <= ocrStat.mtime) {
                        continue; // OCR is newer than source file
                    }
                }
                validFiles.push({ file, size: stat.size });
            }
        }

        if (validFiles.length === 0) {
            new Notice('No files need OCR processing');
            return;
        }

        // Sort by file size (smallest first for better batching)
        validFiles.sort((a, b) => a.size - b.size);

        let processed = 0;
        let failed = 0;

        // One notice for the whole run — it stays up until every file is done.
        const progress = this.startOcrProgress(`Running OCR on ${validFiles.length} file${validFiles.length !== 1 ? 's' : ''} via ${this.getOcrProviderLabel()}...`);

        try {
            // Process in batches
            const batchSize = this.settings.ocrBatchSize;
            for (let i = 0; i < validFiles.length; i += batchSize) {
                // Check if stop was requested
                if (this.ocrStopRequested) {
                    progress.done(`OCR stopped. Processed: ${processed}, failed: ${failed}`);
                    return;
                }

                const batch = validFiles.slice(i, i + batchSize);

                for (const { file } of batch) {
                    // Check if stop was requested before processing each file
                    if (this.ocrStopRequested) {
                        progress.done(`OCR stopped. Processed: ${processed}, failed: ${failed}`);
                        return;
                    }

                    progress.setMessage(`OCR ${processed + failed + 1}/${validFiles.length}: ${file.name} via ${this.getOcrProviderLabel()}...`);

                    try {
                        await this.processFileForOcr(file, progress);
                        processed++;
                    } catch (error) {
                        console.error(`Failed to process ${file.name}:`, error);
                        failed++;

                        // Stop entire batch processing on quota exceeded
                        if (error.message.includes('QUOTA_EXCEEDED') || error.message.includes('API_ERROR_429')) {
                            progress.done(`OCR stopped: provider quota limit. Processed: ${processed}, failed: ${failed}`, 10000);
                            return;
                        }
                    }
                }

                // Longer delay between batches to avoid API rate limits
                if (i + batchSize < validFiles.length) {
                    progress.setMessage(`Waiting between batches (${processed} done, ${failed} failed)...`);
                    await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay
                }
            }

            progress.done(`OCR complete: ${processed} processed, ${failed} failed`);
        } finally {
            progress.hide();
        }
    }

    async ocrReprocessAll() {
        if (!(await this.isOcrConfigured())) {
            new Notice(this.ocrConfigError(), 10000);
            return;
        }

        // Temporarily enable force reprocess
        const originalForceReprocess = this.settings.ocrForceReprocess;
        this.settings.ocrForceReprocess = true;

        try {
            await this.ocrWatchFolder();
        } finally {
            // Restore original setting
            this.settings.ocrForceReprocess = originalForceReprocess;
        }
    }

    setupFileWatchers() {
        // Registered unconditionally and gated inside the handlers, so
        // toggling OCR on does not require reloading the plugin.

        // Watch for file creation with recursion prevention
        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (this.settings.ocrEnabled && this.settings.ocrAutoProcessNewFiles
                    && this.isOcrTarget(file) && !this.isOcrOutputFile(file)) {
                    this.handleFileCreated(file);
                }
            })
        );

        // Watch for file modification with recursion prevention
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (this.settings.ocrEnabled && this.settings.ocrAutoProcessModifiedFiles
                    && this.isOcrTarget(file) && !this.isOcrOutputFile(file)) {
                    this.handleFileModified(file);
                }
            })
        );
    }

    // Prevent processing OCR output files to avoid infinite recursion
    isOcrOutputFile(file) {
        if (!file || !file.name) return false;

        // Check if file is in the resolved OCR output folder
        const outputFolder = this.getOcrOutputFolder(file);
        if (outputFolder && file.path.startsWith(outputFolder + '/')) {
            return true;
        }

        // Check if file name indicates it's an OCR output
        return file.name.includes('(OCR)') || file.name.includes('OCR Result');
    }

    async handleFileCreated(file) {
        // Prevent re-entry for files already being processed
        if (this.processingFiles.has(file.path)) {
            console.log(`Skipping ${file.name}: already being processed`);
            return;
        }

        // Check if file is in watch folder
        if (!this.isInOcrWatchFolder(file)) {
            return;
        }

        // Check file size
        try {
            const stat = await this.app.vault.adapter.stat(file.path);
            if (stat.size > this.settings.ocrMaxFileSize) {
                console.warn(`Skipping new file ${file.name}: too large (${(stat.size / 1024 / 1024).toFixed(2)}MB)`);
                return;
            }
        } catch (error) {
            console.error(`Failed to get file stats for ${file.name}:`, error);
            return;
        }

        // Add to processing set to prevent re-entry
        this.processingFiles.add(file.path);

        // Small delay to ensure file is fully written
        setTimeout(async () => {
            try {
                await this.processFileForOcr(file);
            } catch (error) {
                console.error(`Auto-OCR failed for new file ${file.name}:`, error);
            } finally {
                // Always remove from processing set
                this.processingFiles.delete(file.path);
            }
        }, 1000);
    }

    async handleFileModified(file) {
        // Prevent re-entry for files already being processed
        if (this.processingFiles.has(file.path)) {
            console.log(`Skipping ${file.name}: already being processed`);
            return;
        }

        // Check if file is in watch folder
        if (!this.isInOcrWatchFolder(file)) {
            return;
        }

        // Check if OCR note exists
        const ocrPath = this.getOcrNotePath(file);
        const ocrExists = await this.app.vault.adapter.exists(ocrPath);
        
        if (!ocrExists) {
            return; // No existing OCR to update
        }

        try {
            // Check if source file is newer than OCR note
            const fileStat = await this.app.vault.adapter.stat(file.path);
            const ocrStat = await this.app.vault.adapter.stat(ocrPath);
            
            if (fileStat.mtime <= ocrStat.mtime) {
                return; // OCR is already up to date
            }

            // Check file size
            if (fileStat.size > this.settings.ocrMaxFileSize) {
                console.warn(`Skipping modified file ${file.name}: too large (${(fileStat.size / 1024 / 1024).toFixed(2)}MB)`);
                return;
            }
        } catch (error) {
            console.error(`Failed to check file stats for ${file.name}:`, error);
            return;
        }

        // Add to processing set to prevent re-entry
        this.processingFiles.add(file.path);

        // Small delay to ensure file modifications are complete
        setTimeout(async () => {
            try {
                // The source changed, so the existing note is stale — rewrite
                // it rather than going through the "skip if exists" path.
                await this.runOcrOnFile(file);
            } catch (error) {
                console.error(`Auto-OCR update failed for ${file.name}:`, error);
            } finally {
                // Always remove from processing set
                this.processingFiles.delete(file.path);
            }
        }, 2000);
    }

    stopOcrProcessing() {
        this.ocrStopRequested = true;
        new Notice('OCR processing will stop after current file completes...');
    }

    onunload() {
        // Clear auto-organize interval
        if (this._organizeIntervalId) {
            clearInterval(this._organizeIntervalId);
            this._organizeIntervalId = null;
        }

        // Stop any ongoing OCR processing
        this.ocrStopRequested = true;
        
        // Clear all processing sets to stop any pending operations
        this.processingFiles.clear();
        this.processedFiles.clear();
        
        // Remove any active file watchers
        if (this.fileWatchers) {
            this.fileWatchers.forEach(watcher => {
                if (watcher && typeof watcher.unregister === 'function') {
                    watcher.unregister();
                }
            });
            this.fileWatchers = [];
        }
    }
};