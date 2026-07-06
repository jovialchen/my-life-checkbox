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

function dayLabel(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
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
  const projects = [];
  const codeBlockMatch = md.match(/```\s*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const lines = codeBlockMatch[1].trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        const names = trimmed.split(/\s+/);
        for (const name of names) {
          if (name && !projects.includes(name)) projects.push(name);
        }
      }
    }
  }
  return projects;
}

function parseRecords(md) {
  const records = [];
  const lines = md.split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) { inTable = false; continue; }

    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
    if (cells.length < 3) continue;
    if (cells[0] === '日期' || cells[0].startsWith('-') || cells[0].startsWith(':-')) {
      inTable = true; continue;
    }
    if (!cells[0]) continue;

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
  const hourMatch = str.match(/(\d+)\s*(hr|hour|h)/i);
  if (hourMatch) minutes += parseInt(hourMatch[1]) * 60;
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
    this.currentOffset = 0; // 0=today, -1=yesterday, -2=day before
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

    // ── Day Tabs ──
    const tabs = container.createDiv('lt-tabs');
    [0, -1, -2].forEach(offset => {
      const tab = tabs.createDiv('lt-tab');
      if (offset === this.currentOffset) tab.addClass('active');
      tab.createSpan({ text: offset === 0 ? '今天' : offset === -1 ? '昨天' : '前天', cls: 'lt-tab-label' });
      tab.createSpan({ text: formatCN(dateStr(offset)) + ' ' + dayLabel(offset), cls: 'lt-tab-date' });
      tab.addEventListener('click', () => {
        this.currentOffset = offset;
        this.refreshUI();
      });
    });

    // ── Project Selector (buttons only, no input) ──
    const projSection = container.createDiv('lt-section');
    projSection.createDiv({ text: '📋 项目', cls: 'lt-section-title' });
    const projGrid = projSection.createDiv('lt-project-grid');

    if (projects.length === 0) {
      projGrid.createDiv({ text: '未找到项目简称', cls: 'lt-empty' });
    } else {
      projects.forEach(p => {
        const btn = projGrid.createEl('button', { text: p, cls: 'lt-proj-btn' });
        if (this.selectedProject === p) btn.addClass('active');
        btn.addEventListener('click', () => {
          this.selectedProject = p;
          projGrid.querySelectorAll('.lt-proj-btn').forEach(b => b.removeClass('active'));
          btn.addClass('active');
        });
      });
    }

    // ── Time Selector ──
    const timeSection = container.createDiv('lt-section');
    timeSection.createDiv({ text: '⏱ 时长', cls: 'lt-section-title' });
    const timeGrid = timeSection.createDiv('lt-time-grid');

    TIME_PRESETS.forEach(t => {
      const btn = timeGrid.createEl('button', { text: t.label, cls: 'lt-time-btn' });
      if (this.customTime === t.label) btn.addClass('active');
      btn.addEventListener('click', () => {
        this.customTime = t.label;
        timeGrid.querySelectorAll('.lt-time-btn').forEach(b => b.removeClass('active'));
        btn.addClass('active');
      });
    });

    // ── Notes ──
    const notesSection = container.createDiv('lt-section');
    notesSection.createDiv({ text: '💬 备注（可选）', cls: 'lt-section-title' });
    const notesInput = notesSection.createEl('input', {
      type: 'text',
      placeholder: '学了什么...',
      cls: 'lt-notes-input',
    });

    // ── Record Button ──
    const recordBtn = container.createEl('button', {
      text: '✨ 记录',
      cls: 'lt-record-btn',
    });
    recordBtn.addEventListener('click', async () => {
      if (!this.selectedProject) {
        new Notice('请选择项目 📋'); return;
      }
      const timeStr = this.customTime;
      if (!timeStr) {
        new Notice('请选择时长 ⏱'); return;
      }
      const notes = notesInput.value.trim();
      await this.plugin.appendRecord(this.selectedProject, timeStr, notes, this.currentOffset);
      const min = parseDuration(timeStr);
      new Notice(`✅ ${this.selectedProject} +${formatDuration(min)}`);
      this.selectedProject = null;
      this.customTime = '';
      await this.refreshUI();
    });

    // ── Stats ──
    const statsSection = container.createDiv('lt-stats');
    this.renderStats(statsSection, records);
  }

  renderStats(container, records) {
    const today = dateStr(0);
    const matchDay = (r, d) => r.date === d || r.date === d.slice(5);

    const todayRecords = records.filter(r => matchDay(r, today));
    const todayMin = todayRecords.reduce((s, r) => s + r.durationMin, 0);

    let weekMin = 0;
    for (let i = 0; i < 7; i++) {
      const d = dateStr(-i);
      weekMin += records.filter(r => matchDay(r, d)).reduce((s, r) => s + r.durationMin, 0);
    }

    const monthPrefix = new Date().toISOString().slice(0, 7);
    let monthMin = 0;
    for (const r of records) {
      const d = r.date.length === 10 ? r.date : `2026-${r.date}`;
      if (d.startsWith(monthPrefix)) monthMin += r.durationMin;
    }

    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = dateStr(-i);
      if (records.some(r => matchDay(r, d))) streak++;
      else if (i > 0) break;
    }

    // ── Number row ──
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

    // ── Ring Chart ──
    if (todayMin > 0) {
      const ringRow = container.createDiv('lt-ring-row');
      const ringWrap = ringRow.createDiv('lt-ring-wrap');
      const r = 22, circ = 2 * Math.PI * r;
      const colors = ['#4db8ac','#4d9dc8','#5dae90','#b8a060','#c08080','#80a0c0'];
      const projMap = {};
      todayRecords.forEach(r => { projMap[r.project] = (projMap[r.project] || 0) + r.durationMin; });
      const projEntries = Object.entries(projMap);
      let dashOff = 0;
      const segs = projEntries.map(([,min], i) => {
        const len = (min / todayMin) * circ;
        const s = `<circle class="lt-ring-fill" cx="28" cy="28" r="${r}"
          stroke="${colors[i % colors.length]}" stroke-dasharray="${len} ${circ}"
          stroke-dashoffset="${-dashOff}" />`;
        dashOff += len;
        return s;
      }).join('');
      ringWrap.innerHTML = `<svg class="lt-ring-svg" viewBox="0 0 56 56">
        <circle class="lt-ring-bg" cx="28" cy="28" r="${r}"/>${segs}</svg>`;
      ringWrap.createDiv({ text: '📚', cls: 'lt-ring-center' });
      const legend = ringRow.createDiv('lt-ring-legend');
      projEntries.forEach(([proj, min], i) => {
        const item = legend.createDiv('lt-ring-legend-item');
        item.createSpan({ cls: 'lt-ring-dot', attr: { style: `background:${colors[i % colors.length]}` } });
        item.createSpan({ text: `${proj}: ${formatDuration(min)}` });
      });
    } else {
      container.createDiv({ text: '💤 今天还没学习呢~', cls: 'lt-empty' });
    }

    // ── Horizontal Bars ──
    const weekProjMap = {};
    for (let i = 0; i < 7; i++) {
      const d = dateStr(-i);
      records.filter(r => matchDay(r, d)).forEach(r => {
        weekProjMap[r.project] = (weekProjMap[r.project] || 0) + r.durationMin;
      });
    }
    const weekSorted = Object.entries(weekProjMap).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if (weekSorted.length > 0) {
      const hb = container.createDiv('lt-hbar-section');
      hb.createDiv({ text: '📊 本周排行', cls: 'lt-section-title' });
      const maxW = weekSorted[0][1];
      const barColors = ['#4db8ac','#4d9dc8','#5dae90','#b8a060','#c08080'];
      weekSorted.forEach(([proj, min], i) => {
        const row = hb.createDiv('lt-hbar-row');
        row.createSpan({ text: proj, cls: 'lt-hbar-name' });
        const bw = row.createDiv('lt-hbar-bar-wrap');
        bw.createDiv({ cls: 'lt-hbar-fill', attr: { style: `width:${(min/maxW)*100}%;background:${barColors[i]}` } });
        row.createSpan({ text: formatDuration(min), cls: 'lt-hbar-time' });
      });
    }

    // ── Trend Line ──
    const trend = container.createDiv('lt-trend-section');
    trend.createDiv({ text: '📈 近7天趋势', cls: 'lt-section-title' });
    const td = [];
    for (let i = 6; i >= 0; i--) {
      const d = dateStr(-i);
      td.push({ label: formatCN(d), min: records.filter(r => matchDay(r, d)).reduce((s,r) => s + r.durationMin, 0) });
    }
    const maxT = Math.max(1, ...td.map(d => d.min));
    const W = 200, H = 48, P = 4;
    const pts = td.map((d, i) => {
      const x = P + (i / 6) * (W - P*2);
      const y = H - P - (d.min / maxT) * (H - P*2);
      return `${x},${y}`;
    }).join(' ');
    const dots = td.map((d, i) => {
      const x = P + (i / 6) * (W - P*2);
      const y = H - P - (d.min / maxT) * (H - P*2);
      return `<circle cx="${x}" cy="${y}" r="2.5" class="lt-trend-dot"><title>${d.label}: ${formatDuration(d.min)}</title></circle>`;
    }).join('');
    const labels = td.map((d, i) => {
      const x = P + (i / 6) * (W - P*2);
      return `<text x="${x}" y="${H-1}" class="lt-trend-label">${d.label}</text>`;
    }).join('');
    trend.innerHTML += `<svg class="lt-trend-svg" viewBox="0 0 ${W} ${H}">
      <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" class="lt-trend-axis"/>
      <polyline class="lt-trend-line" points="${pts}"/>${dots}${labels}</svg>`;

    // ── Recent ──
    const recent = records.slice(0, 3);
    if (recent.length > 0) {
      const rr = container.createDiv('lt-recent');
      rr.createDiv({ text: '📝 最近记录', cls: 'lt-section-title' });
      recent.forEach(r => {
        const row = rr.createDiv('lt-recent-item');
        row.createSpan({ text: r.project, cls: 'lt-recent-proj' });
        row.createSpan({ text: r.duration, cls: 'lt-recent-time' });
        if (r.notes) row.createSpan({ text: r.notes, cls: 'lt-recent-note' });
      });
    }
  }
}

// ── Settings ────────────────────────────────────────────────
class LearningTrackerSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '📚 学习时间记录 · 设置' });
    containerEl.createEl('p', { text: '项目列表自动从 学习时间记录.md 的"项目简称"读取。' });
  }
}

// ── Plugin ──────────────────────────────────────────────────
module.exports = class LearningTrackerPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new LearningTrackerView(leaf, this));
    this.addRibbonIcon('book-open', '打开学习记录', () => this.activateView());
    this.addCommand({ id: 'open-learning-tracker', name: '打开学习记录', callback: () => this.activateView() });
    this.addSettingTab(new LearningTrackerSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.activateView());
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
    } catch { return ''; }
  }

  async appendRecord(project, duration, notes, dayOffset = 0) {
    const md = await this.readFile();
    const targetDate = dateStr(dayOffset);
    const notesCell = notes || '';
    const newRow = `| ${targetDate} | ${project} | ${duration} | ${notesCell} |`;

    const lines = md.split('\n');
    let insertIdx = -1;

    // Find the table: locate header row "| 日期 |" then separator "|------|", insert after separator
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('|') && trimmed.includes('日期') && trimmed.includes('项目')) {
        // Next non-empty line should be separator
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim().startsWith('|') && lines[j].includes('---')) {
            insertIdx = j + 1; // right after separator = top of table
            break;
          }
        }
        break;
      }
    }

    if (insertIdx >= 0) {
      lines.splice(insertIdx, 0, newRow);
    } else {
      new Notice('⚠️ 找不到记录表格'); return;
    }

    const newMd = lines.join('\n');
    const file = this.app.vault.getAbstractFileByPath(DATA_FILE);
    if (file) {
      await this.app.vault.modify(file, newMd);
    } else {
      await this.app.vault.create(DATA_FILE, newMd);
    }
  }

  async loadSettings() { this.settings = Object.assign({}, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
};
