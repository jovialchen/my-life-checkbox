const { Plugin, ItemView, PluginSettingTab, Setting } = require('obsidian');

const VIEW_TYPE = 'daily-checkin-view';
const DATA_FILE = '每日打卡.md';

const DEFAULT_HABITS = [
  { name: '呼吸练习', icon: '🌬️' },
  { name: '面部哑铃', icon: '💪' },
  { name: '面部刮痧', icon: '💆' },
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

// ── Markdown table parser ───────────────────────────────────
function parseTable(md) {
  const habits = [...DEFAULT_HABITS];
  const records = {}; // { '2026-07-06': [3,2,1,0], ... }

  if (!md) return { habits, records };

  const lines = md.split('\n');
  let inTable = false;
  let headerHabits = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) { inTable = false; continue; }

    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
    if (cells.length === 0) continue;

    // Skip separator line
    if (cells[0].startsWith('-') || cells[0].startsWith(':-')) {
      inTable = true;
      continue;
    }

    if (cells[0] === '日期') {
      // Header row — extract habit names
      headerHabits = cells.slice(1);
      for (let i = 0; i < Math.min(headerHabits.length, 3); i++) {
        habits[i] = { name: headerHabits[i], icon: habits[i]?.icon || '✨' };
      }
      inTable = true;
      continue;
    }

    if (inTable && cells[0].match(/^\d{4}-\d{2}-\d{2}/)) {
      const date = cells[0];
      const counts = cells.slice(1, 4).map(c => parseInt(c) || 0);
      records[date] = counts;
    }
  }

  return { habits, records };
}

function buildMarkdown(habits, records) {
  const header = `# 🌸 每日打卡\n\n> 每一次点击，都是对自己的温柔 ✨\n\n`;
  const tableHeader = `| 日期 | ${habits.map(h => h.name).join(' | ')} |\n|------|${habits.map(() => '------').join('|')}|\n`;

  const sortedDates = Object.keys(records).sort().reverse();
  const rows = sortedDates.map(date => {
    const counts = records[date];
    return `| ${date} | ${counts.map(c => c || 0).join(' | ')} |`;
  }).join('\n');

  return header + tableHeader + rows + '\n';
}

// ── Main View ───────────────────────────────────────────────
class DailyCheckinView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentOffset = 0;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '🌸 每日打卡'; }
  getIcon() { return 'heart'; }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('daily-checkin-container');
    await this.refreshUI();
  }

  async refreshUI() {
    const container = this.containerEl.children[1];
    container.empty();

    const { habits, records } = await this.plugin.readData();

    // ── Header ──
    const header = container.createDiv('checkin-header');
    header.createSpan({ text: '🌸 每日打卡', cls: 'checkin-title' });

    // ── Day Tabs ──
    const tabs = container.createDiv('checkin-tabs');
    [0, -1, -2].forEach(offset => {
      const tab = tabs.createDiv('checkin-tab');
      if (offset === this.currentOffset) tab.addClass('active');
      tab.createSpan({ text: offset === 0 ? '今天' : offset === -1 ? '昨天' : '前天', cls: 'tab-label' });
      tab.createSpan({ text: formatCN(dateStr(offset)) + ' ' + dayLabel(offset), cls: 'tab-date' });
      tab.addEventListener('click', () => {
        this.currentOffset = offset;
        this.refreshUI();
      });
    });

    // ── Habit Cards ──
    const date = dateStr(this.currentOffset);
    const counts = records[date] || [0, 0, 0];

    const cardsContainer = container.createDiv('checkin-cards');

    habits.forEach((habit, i) => {
      const card = cardsContainer.createDiv('checkin-card');
      card.setAttr('data-habit', i);

      // Icon + Name
      const left = card.createDiv('card-left');
      const iconWrap = left.createDiv('card-icon');
      iconWrap.setText(habit.icon);
      left.createSpan({ text: habit.name, cls: 'card-name' });

      // Count + buttons
      const right = card.createDiv('card-right');
      const minusBtn = right.createEl('button', { text: '−', cls: 'card-btn btn-minus' });
      if (counts[i] === 0) minusBtn.disabled = true;

      const countEl = right.createSpan({ text: String(counts[i] || 0), cls: 'card-count' });
      if ((counts[i] || 0) === 0) countEl.addClass('zero');

      const plusBtn = right.createEl('button', { text: '+', cls: 'card-btn btn-plus' });

      // Events
      const update = async (delta) => {
        const { habits, records } = await this.plugin.readData();
        const d = dateStr(this.currentOffset);
        if (!records[d]) records[d] = [0, 0, 0];
        records[d][i] = Math.max(0, (records[d][i] || 0) + delta);
        await this.plugin.writeData(habits, records);
        countEl.setText(String(records[d][i]));
        countEl.toggleClass('zero', records[d][i] === 0);
        minusBtn.disabled = records[d][i] === 0;
        card.addClass('bounce');
        setTimeout(() => card.removeClass('bounce'), 300);
        this.refreshStats(container, habits, records);
      };

      minusBtn.addEventListener('click', () => update(-1));
      plusBtn.addEventListener('click', () => update(1));
    });

    // ── Stats ──
    this.refreshStats(container, habits, records);
  }

  refreshStats(container, habits, records) {
    const oldStats = container.querySelector('.checkin-stats');
    if (oldStats) oldStats.remove();

    const stats = container.createDiv('checkin-stats');

    const date = dateStr(this.currentOffset);
    const todayRecords = records[date] || [0, 0, 0];
    const todayTotal = todayRecords.reduce((a, b) => a + b, 0);

    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
      const d = dateStr(-i);
      const r = records[d] || [0, 0, 0];
      weekTotal += r.reduce((a, b) => a + b, 0);
    }

    const now = new Date();
    const monthPrefix = now.toISOString().slice(0, 7);
    let monthTotal = 0;
    for (const [d, r] of Object.entries(records)) {
      if (d.startsWith(monthPrefix)) monthTotal += r.reduce((a, b) => a + b, 0);
    }

    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = dateStr(-i);
      const r = records[d];
      if (r && r.some(v => v > 0)) streak++;
      else if (i > 0) break;
    }

    // ── Number row ──
    const numRow = stats.createDiv('stats-num-row');
    [
      { val: todayTotal, label: '今日' },
      { val: weekTotal, label: '本周' },
      { val: monthTotal, label: '本月' },
      { val: streak, label: '连续🔥' },
    ].forEach(s => {
      const item = numRow.createDiv('stat-num-item');
      item.createSpan({ text: String(s.val), cls: 'stat-num-val' });
      item.createSpan({ text: s.label, cls: 'stat-num-label' });
    });

    // ── Ring Chart (donut) ──
    const ringRow = stats.createDiv('stats-ring-row');

    // SVG ring
    const ringWrap = ringRow.createDiv('stats-ring-wrap');
    const r = 22, circ = 2 * Math.PI * r;
    const totalForRing = todayTotal || 1; // avoid 0
    const colors = ['#5dbdb4', '#5b9ec8', '#6bae98'];

    const svg = `<svg class="stats-ring-svg" viewBox="0 0 56 56">
      <circle class="stats-ring-bg" cx="28" cy="28" r="${r}"/>
      ${todayRecords.map((count, i) => {
        const prevSum = todayRecords.slice(0, i).reduce((a,b) => a+b, 0);
        const dashLen = (count / totalForRing) * circ;
        const dashOff = circ - (prevSum / totalForRing) * circ;
        return count > 0 ? `<circle class="stats-ring-fill" cx="28" cy="28" r="${r}"
          stroke="${colors[i]}" stroke-dasharray="${dashLen} ${circ}"
          stroke-dashoffset="${dashOff}" style="transition: all 0.6s ease;"/>` : '';
      }).join('')}
    </svg>`;
    ringWrap.innerHTML = svg;
    const center = ringWrap.createDiv('stats-ring-center');
    center.setText(todayTotal > 0 ? '✨' : '💤');

    // Ring legend
    const legend = ringRow.createDiv('stats-ring-legend');
    habits.forEach((h, i) => {
      const item = legend.createDiv('stats-ring-legend-item');
      item.createSpan({ cls: `stats-ring-dot d${i}` });
      item.createSpan({ text: `${h.icon} ${h.name}: ${todayRecords[i] || 0}` });
    });

    // ── 7-day bar chart ──
    const barsWrap = stats.createDiv('stats-bars');
    barsWrap.createDiv({ text: '📊 近7天', cls: 'stat-num-label' });
    const barsInner = barsWrap.createDiv({ cls: 'stats-bars-inner' });
    barsInner.style.cssText = 'display:flex;align-items:flex-end;justify-content:center;gap:4px;height:52px;';

    const maxVal = Math.max(1, ...Array.from({ length: 7 }, (_, i) => {
      const d = dateStr(-6 + i);
      return (records[d] || [0,0,0]).reduce((a,b) => a+b, 0);
    }));

    for (let i = 6; i >= 0; i--) {
      const d = dateStr(-i);
      const r = records[d] || [0, 0, 0];
      const total = r.reduce((a, b) => a + b, 0);
      const pct = Math.max(2, (total / maxVal) * 100);

      const barWrap = barsInner.createDiv('bar-wrap');
      const bar = barWrap.createDiv('bar');
      bar.style.height = pct + '%';
      if (total === 0) bar.addClass('empty');
      barWrap.createSpan({ text: formatCN(d), cls: 'bar-label' });
    }

    // ── Streak badge ──
    const streakRow = stats.createDiv('stats-streak');
    const badge = streakRow.createDiv('streak-badge');
    badge.setText(streak > 0 ? `🔥 连续打卡 ${streak} 天` : '💤 今天开始打卡吧~');
  }
}

// ── Settings Tab ────────────────────────────────────────────
class CheckinSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '🌸 每日打卡 · 设置' });

    for (let i = 0; i < 3; i++) {
      const habit = this.plugin.settings.habits[i];
      new Setting(containerEl)
        .setName(`项目 ${i + 1}`)
        .addText(text => text
          .setPlaceholder('习惯名称')
          .setValue(habit.name)
          .onChange(async (val) => {
            this.plugin.settings.habits[i].name = val;
            await this.plugin.saveSettings();
          }))
        .addText(text => {
          text.inputEl.style.width = '50px';
          text.setPlaceholder('图标')
            .setValue(habit.icon)
            .onChange(async (val) => {
              this.plugin.settings.habits[i].icon = val || '✨';
              await this.plugin.saveSettings();
            });
        });
    }
  }
}

// ── Plugin ──────────────────────────────────────────────────
module.exports = class DailyCheckinPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // Register the sidebar view
    this.registerView(VIEW_TYPE, (leaf) => new DailyCheckinView(leaf, this));

    // Ribbon icon to open
    this.addRibbonIcon('heart', '打开每日打卡', () => {
      this.activateView();
    });

    // Command to open
    this.addCommand({
      id: 'open-daily-checkin',
      name: '打开每日打卡',
      callback: () => this.activateView(),
    });

    // Settings
    this.addSettingTab(new CheckinSettingTab(this.app, this));

    // Auto-open on load
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
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  // ── Data Layer ──────────────────────────────
  async readData() {
    // Habits always come from settings; md file only stores records
    const habits = (this.settings && this.settings.habits)
      ? this.settings.habits.map(h => ({ ...h }))
      : DEFAULT_HABITS.map(h => ({ ...h }));

    try {
      const exists = await this.app.vault.adapter.exists(DATA_FILE);
      if (!exists) return { habits, records: {} };
      const md = await this.app.vault.adapter.read(DATA_FILE);
      const { records } = parseTable(md);
      return { habits, records };
    } catch {
      return { habits, records: {} };
    }
  }

  async writeData(habits, records) {
    const md = buildMarkdown(habits, records);
    const file = this.app.vault.getAbstractFileByPath(DATA_FILE);
    if (file) {
      await this.app.vault.modify(file, md);
    } else {
      await this.app.vault.create(DATA_FILE, md);
    }
  }

  // ── Settings ───────────────────────────────
  async loadSettings() {
    this.settings = Object.assign({
      habits: DEFAULT_HABITS.map(h => ({ ...h })),
    }, await this.loadData());
    // Auto-fix if habits length changed (e.g. 4→3)
    if (this.settings.habits.length !== DEFAULT_HABITS.length) {
      this.settings.habits = DEFAULT_HABITS.map(h => ({ ...h }));
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
