# Vaultkeeper for Obsidian

> *Note:* This plugin is being vibe coded. So, if you are not wanting AI code in your vault, please do not use this plugin. Though I am a full time Full Stack Developer so I can validate none of the code is leaking secrets or collecting personal data if that helps you.

A comprehensive Obsidian plugin that organizes and manages attachments, renames pasted files automatically, and extracts text from images and PDFs using OCR — all within your vault.

## 🚀 Features

### 📁 Attachment Organization
- **Flexible destination**: Move attachments using Obsidian's built-in setting, same folder as the linking note, or a separate named folder
- **Subfolder sorting**: Sort into subfolders by date, file type, or a custom pattern using tokens like `{{year}}`, `{{month}}`, `{{day}}`, `{{type}}`, `{{filename}}`
- **Configurable extensions**: Define exactly which file types count as attachments
- **Ignore rules**: Skip specified folders during organizing or purging
- **Empty folder cleanup**: Folders left empty after organizing are automatically deleted
- **Auto-organize**: Run on startup and/or on a repeating interval

### ✏️ Paste Rename
- Automatically rename files when pasted or dropped into a note
- **Five modes**: do nothing, date-based, custom pattern, ask each time, or date pre-filled + ask to confirm
- **Tokens**: `{{year}}`, `{{month}}`, `{{day}}`, `{{time}}`, `{{type}}`, `{{filename}}` (active note name), `{{original}}` (pasted file's original name)
- Embed links in the note are updated automatically to match the new filename

### 🧹 Attachment Cleanup
- **Find Unlinked Attachments**: Identify attachment files not linked from any note
- **Purge Unlinked Attachments**: Safely delete unlinked attachments — select all, none, or individual files via checkboxes, then confirm before anything is deleted

### 🔍 OCR (Optical Character Recognition)
- **Four providers**: a custom/self-hosted OpenAI-compatible server (Ollama, LM Studio, vLLM, llama.cpp, LiteLLM), OpenAI, Anthropic, or Google Gemini
- Extract text from images (PNG, JPG, JPEG, WEBP, BMP, GIF, HEIC, HEIF) and PDFs
- **Progress notice** stays on screen with an elapsed-time counter until the run finishes — self-hosted models can take minutes
- Watch and output folders can follow Obsidian's attachment setting or Vaultkeeper's own organize destination
- **Custom note properties**: define whatever YAML frontmatter you want on OCR notes
- Auto-process new files added to a watch folder
- Auto-update OCR notes when source files are modified
- Process files in batches with rate-limit handling and exponential backoff
- Fully customizable prompt and output note template
- Pick any individual file to OCR via command palette

## Installation

### 🧪 Using BRAT (Beta Reviewer's Auto-update Tool)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Open BRAT settings
3. Click **Add Beta Plugin**
4. Enter: `DudeThatsErin/vaultkeeper`
5. Click **Add Plugin**
6. Enable "Vaultkeeper" in Community Plugins settings

## 📘 Usage

### 🔄 Organizing Attachments

1. Open **Settings > Attachment Organizer > Organization Settings**
2. Set your **Destination**:
   - *Use Obsidian settings* — respects your vault's "Default location for new attachments" setting
   - *Same location as file* — moves attachments to the same folder as the note that links to them
   - *Separate folder* — uses a configured folder name (e.g. `attachments`)
3. Optionally choose **Sort into subfolders by** (none, date, file type, or custom pattern)
4. Run **"Organize attachments"** from the Command Palette (`Ctrl/Cmd+P`)

### ✏️ Paste Rename

1. Open **Settings > Attachment Organizer > Paste Rename Settings**
2. Choose a **Rename mode**:
   - *Do not rename* — default, no change
   - *Date-based* — auto-rename using a date pattern (e.g. `2026-05-04.png`)
   - *Custom pattern* — auto-rename using any token combination
   - *Ask each time* — a prompt appears after each paste so you can type the name
   - *Date-based + ask to confirm* — prompt pre-filled with the date pattern
3. Configure the pattern using tokens: `{{year}}`, `{{month}}`, `{{day}}`, `{{time}}`, `{{type}}`, `{{filename}}` (note name), `{{original}}` (pasted file's original name)

### 🗑 Purging Unlinked Attachments

1. Run **"Purge unlinked attachments"** from the Command Palette
2. A modal lists all unlinked attachments with checkboxes (all selected by default)
3. Use **Select All** / **Select None** to bulk-toggle, or check/uncheck individual files
4. Click **Delete Selected** → review the confirmation list → click **Delete** to permanently remove, or **← Back** to revise
5. Click **Cancel** at any point to abort

### 🔍 Using OCR

#### Setup
1. Open **Settings > Vaultkeeper > OCR**
2. Toggle **Enable OCR** on
3. Pick an **OCR provider** and configure it:
   - *Custom / self-hosted* — set the base URL of any OpenAI-compatible server and a **vision-capable** model name. An API key is optional. Use **Test connection** to confirm the server is reachable and lists your model.
   - *OpenAI* — save your [API key](https://platform.openai.com/api-keys) as a secret and set a vision-capable model
   - *Anthropic* — save your [API key](https://console.anthropic.com/settings/keys) as a secret and set a Claude model
   - *Google Gemini* — save your [API key](https://makersuite.google.com/app/apikey) as a secret and pick a model
4. Set the **OCR watch folder**: a specific folder, Obsidian's attachment folder, or Vaultkeeper's organize destination
5. Set the **OCR output folder**: a specific folder, the source file's folder, Obsidian's attachment folder, or Vaultkeeper's organize destination

##### Self-hosted example (Ollama)

Pull a multimodal model — a text-only model will fail with *"model does not support multimodal requests"*:

```bash
ollama pull qwen2.5vl:7b
```

Then set **Custom server base URL** to `http://localhost:11434/v1` and **Custom model** to `qwen2.5vl:7b`. Nothing leaves your machine. Raise **Custom request timeout** if the model runs on CPU.

> PDFs are only supported by Gemini and Anthropic. OpenAI and self-hosted vision models take images only — convert pages to images first.

#### Commands
| Command | Description |
|---|---|
| `OCR: Process watch folder` | Batch-process all unprocessed files in the watch folder |
| `OCR: Reprocess all files (force update)` | Re-OCR every file even if a note already exists |
| `OCR: Process current file` | OCR the file currently open in the editor |
| `OCR: Pick attachment to process` | Choose any file in the vault to OCR |
| `OCR: Stop processing` | Halt batch processing after the current file finishes |

#### Output format
Each OCR result is saved as a `.md` note (e.g. `screenshot.png` → `screenshot (OCR).md`) using a customizable template. Default structure:

```markdown
---
ocr-processed: true
---

# OCR Result for screenshot.png

## Extracted Text

[extracted text here]
```

Turn on **Note properties** to add your own YAML frontmatter. For example:

```yaml
source: "[[{{path}}]]"
processed: {{date}}
status: {{status}}
```

produces:

```markdown
---
source: "[[assets/screenshot.png]]"
processed: 2026-08-11
status: completed
ocr-processed: true
---
```

The **OCR processed field** is always appended (and not duplicated if you list it yourself).

#### Supported file types
Images: PNG, JPG, JPEG, WEBP, BMP, GIF, HEIC, HEIF — Documents: PDF

## ⚙️ Settings Reference

### General Settings
| Setting | Description |
|---|---|
| Attachment extensions | Comma-separated list of extensions treated as attachments |
| Ignore folders | Comma-separated folder paths to skip during organizing or purging |

### Organization Settings
| Setting | Description |
|---|---|
| Destination | *Obsidian settings*, *Same location as file*, or *Separate folder* |
| Obsidian attachment folder | Read-only preview of what Obsidian's own setting resolves to |
| Default folder name | Folder name used in separate folder mode |
| Sort into subfolders by | None, Date (year/month), File type, or Custom pattern. Not applicable in *Same location as file* mode. |
| Custom subfolder pattern | Tokens: `{{year}}`, `{{month}}`, `{{day}}`, `{{type}}`, `{{filename}}` |
| Organize on startup | Auto-organize every time Obsidian starts |
| Auto-organize interval | Re-organize on a timer (minutes, 0 = disabled) |

### Paste Rename Settings
| Setting | Description |
|---|---|
| Rename mode | None, Date-based, Custom pattern, Ask each time, or Date + ask |
| Date format pattern | Pattern used for date-based and date+ask modes |
| Custom rename pattern | Pattern used for custom mode |

Available tokens for paste rename patterns:

| Token | Value |
|---|---|
| `{{year}}` | 4-digit year |
| `{{month}}` | 2-digit month |
| `{{day}}` | 2-digit day |
| `{{time}}` | `HHmmss` timestamp |
| `{{type}}` | File extension (e.g. `png`) |
| `{{filename}}` | Name of the active note |
| `{{original}}` | Original pasted filename (without extension) |

### Purge Settings
| Setting | Description |
|---|---|
| Confirm before purging | Show confirmation prompt before deleting unlinked attachments |

### OCR Settings
| Setting | Description |
|---|---|
| Enable OCR | Toggle OCR processing on/off |
| OCR provider | Custom / self-hosted, OpenAI, Anthropic, or Google Gemini |
| Custom server base URL | OpenAI-compatible endpoint root, e.g. `http://localhost:11434/v1` |
| Custom model | Vision-capable model name as your server reports it |
| Custom API key | Optional — leave unset for servers that need no auth |
| Custom request timeout | Seconds to wait before giving up (30–1800) |
| Test custom server | Check the server responds and lists your model |
| OpenAI / Anthropic / Gemini API key | Stored via Obsidian's secret storage, never in plain settings |
| OpenAI / Anthropic / Gemini model | Model used by the selected provider |
| OCR watch folder | A specific folder, Obsidian's attachment folder, or Vaultkeeper's organize destination |
| Watch folder path | The folder to monitor, when *A specific folder* is selected. Empty = whole vault. |
| OCR output folder | A specific folder, the source file's folder, Obsidian's attachment folder, or Vaultkeeper's organize destination |
| Output folder path | The folder to write notes to, when *A specific folder* is selected |
| Output subfolder | Subfolder appended to the resolved output location. Empty = write directly there. |

### OCR Processing Settings
| Setting | Description |
|---|---|
| Batch size | Files processed per batch (1 recommended for free tier) |
| Max file size (MB) | Files larger than this are skipped |
| Force reprocess | Re-OCR files even if a note already exists |
| Auto-process new files | OCR files automatically when added to watch folder |
| Auto-process modified files | Re-OCR when a source file is updated |
| OCR processed field | Frontmatter field name used to mark processed files |

### OCR Templates
| Setting | Description |
|---|---|
| Note properties | Add YAML frontmatter properties to each OCR note |
| Properties | One `key: value` per line, token-substituted |
| OCR prompt | Prompt sent to the model for each file |
| OCR output template | Body of the generated note |

Available variables in both the properties and the output template:

| Token | Value |
|---|---|
| `{{content}}` | The extracted text (output template only) |
| `{{filename}}` | Source filename with extension |
| `{{basename}}` | Source filename without extension |
| `{{path}}` | Full vault path to the source file |
| `{{link}}` | Wikilink to the source file |
| `{{date}}` | `YYYY-MM-DD` |
| `{{time}}` | `HH:mm` |
| `{{datetime}}` | `YYYY-MM-DD HH:mm` |
| `{{status}}` | Processing status, e.g. `completed` |
| `{{provider}}` | Provider that ran the OCR |
| `{{model}}` | Model that ran the OCR |

## Support

- 💬 [Discord Support](https://discord.gg/XcJWhE3SEA) — fastest response
- 🐛 [Report Issues](https://github.com/DudeThatsErin/vaultkeeper/issues)
- ⭐ [Star on GitHub](https://github.com/DudeThatsErin/vaultkeeper)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/erinskidds)
