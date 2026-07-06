const { Plugin, ItemView, PluginSettingTab, Setting, Notice } = require('obsidian');

const VIEW_TYPE = 'learning-tracker-view';
const DATA_FILE = '学习时间记录.md';

const TIME_PRESETS = [
  { label: '5m',  minutes: 5 },
  { label: '10m', minutes: 10 },
  { label: '15m', minutes: 15 },
  { label: '20m', minutes: 20 },
  { label: '30m', minutes: 30 },
  { label: '1hr',  minutes: 60 },
  { label: '2hr',  minutes: 120 },
  { label: '3hr',  minutes: 180 },
];

// ── Helpers ─────────────────────────────────────────────────
function dateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function formatCN(date) {
  const [y, m, d] = date.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

function formatDuration(totalMinutes) {
  if (totalMinutes >= 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `${h}hr ${m}min` : `${h}hr`;
  }
  return `${totalMinutes}min`;
}

// ── Markdown parser ─────────────────────────────────────────
function parseProjects(md) {
  // Extract project names from the code block in "项目简称" section
  const projects = [];
  const codeBlockMatch = md.match(/```\s*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const lines = codeBlockMatch[1].trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        // Each line may have multiple projects separated by spaces
        const names = trimmed.split(/\s+/);
        for (const name of names) {
          if (name && !projects.includes(name)) {
            projects.push(name);
          }
        }
      }
    }
  }
  return projects;
}

function parseRecords(md) {
  // Parse all record tables (both 快速记录 and 全部记录)
  const records = []; // [{ date, project, duration, durationMin, notes }]
  const lines = md.split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) { inTable = false; continue; }

    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
    if (cells.length < 3) continue;

    // Skip header and separator lines
    if (cells[0] === '日期' || cells[0].startsWith('-') || cells[0].startsWith(':-')) {
      inTable = true;
      continue;
    }

    // Skip empty rows
    if (!cells[0]) continue;

    // Date must match YYYY-MM-DD or MM-DD format
    if (cells[0].match(/^\d{4}-\d{2}-\d{2}/) || cells[0].match(/^\d{2}-\d{2}/)) {
      const date = cells[0];
      const project = cells[1] || '';
      const duration = cells[2] || '';
      const notes = cells[3] || '';
      const durationMin = parseDuration(duration);
      if (project && duration) {
        records.push({ date, project, duration, durationMin, notes });
      }
    }
  }

  return records;
}

function parseDuration(str) {
  if (!str) return 0;
  let minutes = 0;
  // Match hours: 1hr, 2h, 1 hour, etc.
  const hourMatch = str.match(/(\d+)\s*(hr|hour|h)/i);
  if (hourMatch) minutes += parseInt(hourMatch[1]) * 60;
  // Match minutes: 30min, 10m, 5 min, etc.
  const minMatch = str.match(/(\d+)\s*(min|minute|m)/i);
  if (minMatch) minutes += parseInt(minMatch[1]);
  return minutes;
}

// ── Main View ───────────────────────────────────────────────
class LearningTrackerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedProject = null;
    this.customTime = '';
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '📚 学习记录'; }
  getIcon() { return 'book-open'; }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('learning-tracker-container');
    await this.refreshUI();
  }

  async refreshUI() {
    const container = this.containerEl.children[1];
    container.empty();

    const md = await this.plugin.readFile();
    const projects = parseProjects(md);
    const records = parseRecords(md);

    // ── Header ──
    const header = container.createDiv('lt-header');
    header.createSpan({ text: '📚 学习记录', cls: 'lt-title' });

    // ── Project Selector ──
    const projSection = container.createDiv('lt-section');
    projSection.createDiv({ text: '📋 选择项目', cls: 'lt-section-title' });
    const projGrid = projSection.createDiv('lt-project-grid');

    if (projects.length === 0) {
      projGrid.createDiv({ text: '未找到项目，请在 学习时间记录.md 中添加', cls: 'lt-empty' });
    } else {
      projects.forEach(p => {
        const btn = projGrid.createEl('button', { text: p, cls: 'lt-proj-btn' });
        if (this.selectedProject === p) btn.addClass('active');
        btn.addEventListener('click', () => {
          this.selectedProject = p;
          // Update all project buttons
          projGrid.querySelectorAll('.lt-proj-btn').forEach(b => b.removeClass('active'));
          btn.addClass('active');
        });
      });
    }

    // ── Custom Project Input ──
    const customRow = projSection.createDiv('lt-custom-row');
    const customInput = customRow.createEl('input', {
      type: 'text',
      placeholder: '或输入其他项目名...',
      cls: 'lt-custom-input',
    });
    customInput.addEventListener('input', () => {
      this.selectedProject = customInput.value || null;
      projGrid.querySelectorAll('.lt-proj-btn').forEach(b => b.removeClass('active'));
    });

    // ── Time Selector ──
    const timeSection = container.createDiv('lt-section');
    timeSection.createDiv({ text: '⏱ 时长', cls: 'lt-section-title' });
    const timeGrid = timeSection.createDiv('lt-time-grid');

    TIME_PRESETS.forEach(t => {
      const btn = timeGrid.createEl('button', { text: t.label, cls: 'lt-time-btn' });
      btn.addEventListener('click', () => {
        this.customTime = t.label;
        timeGrid.querySelectorAll('.lt-time-btn').forEach(b => b.removeClass('active'));
        btn.addClass('active');
        const customInput = container.querySelector('.lt-time-input');
        if (customInput) customInput.value = '';
      });
    });

    // Custom time
    const customTimeRow = timeSection.createDiv('lt-custom-row');
    const timeInput = customTimeRow.createEl('input', {
      type: 'text',
      placeholder: '自定义时长，如 45min 或 1.5hr',
      cls: 'lt-custom-input lt-time-input',
    });
    timeInput.addEventListener('input', () => {
      this.customTime = timeInput.value || null;
      timeGrid.querySelectorAll('.lt-time-btn').forEach(b => b.removeClass('active'));
    });

    // ── Notes ──
    const notesSection = container.createDiv('lt-section');
    notesSection.createDiv({ text: '💬 备注（可选）', cls: 'lt-section-title' });
    const notesInput = notesSection.createEl('input', {
      type: 'text',
      placeholder: '学了什么...',
      cls: 'lt-custom-input',
    });

    // ── Record Button ──
    const recordBtn = container.createEl('button', {
      text: '✨ 记录',
      cls: 'lt-record-btn',
    });
    recordBtn.addEventListener('click', async () => {
      if (!this.selectedProject) {
        new Notice('请先选择项目 📋');
        return;
      }
      const timeStr = this.customTime || '0min';
      const durationMin = parseDuration(timeStr);
      if (durationMin === 0 && !this.customTime) {
        new Notice('请选择或输入时长 ⏱');
        return;
      }
      const notes = notesInput.value.trim();
      await this.plugin.appendRecord(this.selectedProject, timeStr, notes);
      new Notice(`✅ 已记录 ${this.selectedProject} ${formatDuration(durationMin)}`);
      // Reset
      this.selectedProject = null;
      this.customTime = '';
      await this.refreshUI();
    });

    // ── Stats ──
    const statsSection = container.createDiv('lt-stats');
    this.renderStats(statsSection, records);
  }

  renderStats(container, records) {
    // Today
    const today = dateStr(0);
    const todayRecords = records.filter(r => r.date === today || r.date === today.slice(5));
    const todayMin = todayRecords.reduce((s, r) => s + r.durationMin, 0);

    // Week
    let weekMin = 0;
    for (let i = 0; i < 7; i++) {
      const d = dateStr(-i);
      const short = d.slice(5);
      weekMin += records
        .filter(r => r.date === d || r.date === short)
        .reduce((s, r) => s + r.durationMin, 0);
    }

    // Month
    const monthPrefix = new Date().toISOString().slice(0, 7);
    let monthMin = 0;
    for (const r of records) {
      const d = r.date.length === 10 ? r.date : `2026-${r.date}`;
      if (d.startsWith(monthPrefix)) {
        monthMin += r.durationMin;
      }
    }

    // Streak
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = dateStr(-i);
      const short = d.slice(5);
      const has = records.some(r => r.date === d || r.date === short);
      if (has) streak++;
      else if (i > 0) break;
    }

    const numRow = container.createDiv('lt-stats-row');
    [
      { val: formatDuration(todayMin), label: '今日' },
      { val: formatDuration(weekMin), label: '本周' },
      { val: formatDuration(monthMin), label: '本月' },
      { val: streak + '天', label: '连续📆' },
    ].forEach(s => {
      const item = numRow.createDiv('lt-stat-item');
      item.createSpan({ text: s.val, cls: 'lt-stat-val' });
      item.createSpan({ text: s.label, cls: 'lt-stat-label' });
    });

    // Per-project today
    if (todayRecords.length > 0) {
      const projRow = container.createDiv('lt-proj-stats');
      const projectTotals = {};
      todayRecords.forEach(r => {
        projectTotals[r.project] = (projectTotals[r.project] || 0) + r.durationMin;
      });
      Object.entries(projectTotals).forEach(([proj, min]) => {
        const item = projRow.createDiv('lt-proj-stat-item');
        item.createSpan({ text: proj, cls: 'lt-proj-name' });
        item.createSpan({ text: formatDuration(min), cls: 'lt-proj-time' });
      });
    }

    // Recent records (last 5)
    const recent = records.slice(-5).reverse();
    if (recent.length > 0) {
      const recentRow = container.createDiv('lt-recent');
      recentRow.createDiv({ text: '📝 最近记录', cls: 'lt-section-title' });
      recent.forEach(r => {
        const row = recentRow.createDiv('lt-recent-item');
        row.createSpan({ text: r.project, cls: 'lt-recent-proj' });
        row.createSpan({ text: r.duration, cls: 'lt-recent-time' });
        if (r.notes) row.createSpan({ text: r.notes, cls: 'lt-recent-note' });
      });
    }
  }
}

// ── Settings Tab ────────────────────────────────────────────
class LearningTrackerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '📚 学习时间记录 · 设置' });
    containerEl.createEl('p', { text: '项目列表自动从 学习时间记录.md 的"项目简称"区域读取。在那边修改即可。' });
  }
}

// ── Plugin ──────────────────────────────────────────────────
module.exports = class LearningTrackerPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new LearningTrackerView(leaf, this));

    this.addRibbonIcon('book-open', '打开学习记录', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-learning-tracker',
      name: '打开学习记录',
      callback: () => this.activateView(),
    });

    this.addSettingTab(new LearningTrackerSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.activateView();
    });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({ type: VIEW_TYPE, active: true });
        leaf = rightLeaf;
      }
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  async readFile() {
    try {
      const exists = await this.app.vault.adapter.exists(DATA_FILE);
      if (!exists) return '';
      return await this.app.vault.adapter.read(DATA_FILE);
    } catch {
      return '';
    }
  }

  async appendRecord(project, duration, notes) {
    const md = await this.readFile();
    const today = dateStr(0);

    // Build the new row
    const notesCell = notes || '';
    const newRow = `| ${today} | ${project} | ${duration} | ${notesCell} |`;

    // Find the 快速记录 section and insert before the empty row
    const lines = md.split('\n');
    let inQuickSection = false;
    let inTable = false;
    let insertIdx = -1;
    let emptyRowIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Detect "快速记录" section header
      if (line.includes('快速记录')) {
        inQuickSection = true;
        continue;
      }
      // Section boundary
      if (inQuickSection && line.trim().startsWith('---')) {
        break;
      }
      if (inQuickSection && line.trim().startsWith('|')) {
        const trimmed = line.trim();
        const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
        // Empty row: all cells are blank
        if (cells.every(c => !c)) {
          emptyRowIdx = i;
          insertIdx = i;
          break;
        }
        inTable = true;
      }
    }

    // If we found the empty marker row, insert before it
    if (insertIdx >= 0) {
      lines.splice(insertIdx, 0, newRow);
    } else {
      // Fallback: find the last table row in quick section and append after
      // Just insert before the "*每次学完..." hint line
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('每次学完加一行') || lines[i].includes('每次做完就记一笔')) {
          insertIdx = i;
          break;
        }
      }
      if (insertIdx >= 0) {
        lines.splice(insertIdx, 0, newRow);
      } else {
        new Notice('⚠️ 无法定位插入位置，请检查 学习时间记录.md 格式');
        return;
      }
    }

    const newMd = lines.join('\n');
    const file = this.app.vault.getAbstractFileByPath(DATA_FILE);
    if (file) {
      await this.app.vault.modify(file, newMd);
    } else {
      await this.app.vault.create(DATA_FILE, newMd);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
