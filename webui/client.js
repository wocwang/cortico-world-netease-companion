/**
 * 设置页按用途折叠配置分组；实时状态页在打开期间每 2 秒读取一次 World 快照。
 * 宿主的顶部徽章只在开页或手动刷新时取一次。
 */
export default {
  panels: {
    'settings': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const text = {
          refresh: zh ? '刷新' : 'Refresh',
          autoSave: zh ? '修改后自动保存' : 'Auto-save',
          restart: zh ? '重启 World' : 'Restart World',
          on: zh ? '开启' : 'On',
          off: zh ? '关闭' : 'Off',
          saving: zh ? '正在保存…' : 'Saving…',
          saved: zh ? '已保存' : 'Saved',
          empty: zh ? '没有可显示的配置项' : 'No settings to show',
          invalidNumber: title => zh ? `「${title}」不是有效数字，未保存` : `"${title}" is not a valid number; not saved`,
          outOfRange: (title, min, max) => zh
            ? `「${title}」需在 ${min}–${max} 之间，未保存`
            : `"${title}" must be between ${min} and ${max}; not saved`,
          moveUp: zh ? '上移' : 'Up',
          moveDown: zh ? '下移' : 'Down',
          dragHint: zh ? '拖动条目标调整顺序' : 'Drag an item to reorder',
          noTimeline: zh ? '无进度' : 'No timeline',
          saveFailed: msg => zh ? `保存失败：${msg}` : `Save failed: ${msg}`,
          loadFailed: msg => zh ? `读取配置失败：${msg}` : `Could not read settings: ${msg}`,
        };

        const bar = ui.rowbar();
        const status = ui.msgline('');
        const host = ui.h('div');
        bar.append(
          ui.pill(text.autoSave, 'plain'),
          ui.h('span', 'grow'),
          ui.button(text.refresh, { size: 'sm', onClick: () => void load() }),
        );
        ctx.root.append(bar, host, status);

        let groups = [];

        const valueOf = (group, key) => {
          const reader = group.readers.find(item => item.key === key);
          return reader ? reader.read() : undefined;
        };
        const onOff = value => value === true ? text.on : value === false ? text.off : '—';
        const summary = group => {
          const get = key => valueOf(group, key);
          switch (group.kind) {
            case 'commentary':
              return zh
                ? `评论 ${onOff(get('commentary'))} · 报幕 ${onOff(get('announceTracks'))} · 分段 ${onOff(get('segmentComments'))}（${get('segmentCount') ?? '—'} 次 / ${get('segmentEverySeconds') ?? '—'} 秒）· 动作 ${onOff(get('actionHints'))} · 控制 ${onOff(get('allowPlaybackControl'))} · 状态 ${onOff(get('stateComments'))} · 稳定 ${get('settleSeconds') ?? '—'} 秒 · 间隔 ${get('cooldownSeconds') ?? '—'} 秒 · ${get('maxCommentChars') ?? '—'} 字 · ${get('commentExcerpts') ?? '—'} 条`
                : `Comments ${onOff(get('commentary'))} · announce ${onOff(get('announceTracks'))} · segments ${onOff(get('segmentComments'))} (${get('segmentCount') ?? '—'} / ${get('segmentEverySeconds') ?? '—'}s) · actions ${onOff(get('actionHints'))} · control ${onOff(get('allowPlaybackControl'))} · state ${onOff(get('stateComments'))} · settle ${get('settleSeconds') ?? '—'}s · gap ${get('cooldownSeconds') ?? '—'}s · ${get('maxCommentChars') ?? '—'} chars · ${get('commentExcerpts') ?? '—'} excerpts`;
            case 'context':
              return zh
                ? `评论区 ${onOff(get('commentReference'))} · 歌手 ${onOff(get('artistContext'))} · 歌曲 ${onOff(get('songContext'))}`
                : `Comments ${onOff(get('commentReference'))} · artist ${onOff(get('artistContext'))} · song ${onOff(get('songContext'))}`;
            case 'lyrics':
              return zh
                ? `歌词 ${onOff(get('lyricsContext'))} · 翻译 ${onOff(get('lyricsTranslation'))} · ${get('lyricsLines') ?? '—'} 行`
                : `Lyrics ${onOff(get('lyricsContext'))} · translation ${onOff(get('lyricsTranslation'))} · ${get('lyricsLines') ?? '—'} lines`;
            case 'listening':
              return zh
                ? `收录 ${get('listeningTrackLimit') ?? '—'} 首 / ${get('listeningArtistLimit') ?? '—'} 位 · 显示 ${get('listeningRankTrackRange') ?? '—'} / ${get('listeningRankArtistRange') ?? '—'}`
                : `Store ${get('listeningTrackLimit') ?? '—'} / ${get('listeningArtistLimit') ?? '—'} · show ${get('listeningRankTrackRange') ?? '—'} / ${get('listeningRankArtistRange') ?? '—'}`;
            case 'reader': {
              const stored = get('playerPriority');
              const order = Array.isArray(stored) && stored.length
                ? stored
                : (group.players || []).map(player => player.id);
              const names = order.map(id => {
                const player = (group.players || []).find(item => item.id === id);
                return player ? (zh ? player.label : player.labelEn) : id;
              });
              return zh
                ? `优先级 ${names.join(' > ') || '—'} · 窗口降级 ${onOff(get('windowFallback'))}`
                : `Priority ${names.join(' > ') || '—'} · window fallback ${onOff(get('windowFallback'))}`;
            }
            default:
              return `${group.fields.length} ${zh ? '项' : 'fields'}`;
          }
        };

        const invalid = message => {
          status.classList.add('bad');
          status.textContent = message;
        };

        let timers = new Map();
        const queueSave = group => {
          group.sheet.note.textContent = summary(group);
          timers.get(group.id)?.dispose();
          timers.set(group.id, ctx.timeout(() => {
            timers.delete(group.id);
            void save(group);
          }, 400));
        };

        const save = async group => {
          if (ctx.signal.aborted) return;
          const values = {};
          for (const reader of group.readers) {
            if (!reader.read) continue;
            const value = reader.read();
            if (value === undefined) {
              invalid(text.invalidNumber(reader.title));
              return;
            }
            if ((reader.type === 'integer' || reader.type === 'number')
              && typeof value === 'number') {
              if (reader.minimum != null && value < reader.minimum) {
                invalid(text.outOfRange(reader.title, reader.minimum, reader.maximum));
                return;
              }
              if (reader.maximum != null && value > reader.maximum) {
                invalid(text.outOfRange(reader.title, reader.minimum, reader.maximum));
                return;
              }
            }
            values[reader.key] = value;
          }
          try {
            status.classList.remove('bad');
            status.textContent = text.saving;
            await ctx.invoke('save', [values]);
            if (ctx.signal.aborted) return;
            status.textContent = text.saved;
            group.sheet.note.textContent = summary(group);
          } catch (e) {
            if (e && e.name === 'AbortError') return;
            invalid(text.saveFailed(e instanceof Error ? e.message : String(e)));
          }
        };

        const control = (group, field) => {
          const changed = () => queueSave(group);
          if (field.key === 'playerPriority') {
            // 只读条目 + 上移/下移：不提供输入框，也不能增删官方清单之外的播放器。
            const players = Array.isArray(group.players) ? group.players : [];
            const nameOf = id => {
              const player = players.find(item => item.id === id);
              return player ? (zh ? player.label : player.labelEn) : id;
            };
            let order = Array.isArray(field.value) ? field.value.slice() : players.map(player => player.id);
            let dragIndex = -1;
            const node = ui.h('div');
            const move = (index, delta) => {
              const target = index + delta;
              if (target < 0 || target >= order.length) return;
              [order[index], order[target]] = [order[target], order[index]];
              render();
              changed();
            };
            const render = () => {
              node.replaceChildren();
              order.forEach((id, index) => {
                const row = ui.rowbar();
                const player = players.find(item => item.id === id);
                row.draggable = true;
                row.title = text.dragHint;
                row.addEventListener('dragstart', () => { dragIndex = index; });
                row.addEventListener('dragover', event => event.preventDefault());
                row.addEventListener('drop', event => {
                  event.preventDefault();
                  if (dragIndex < 0 || dragIndex === index) return;
                  const [moved] = order.splice(dragIndex, 1);
                  order.splice(index, 0, moved);
                  dragIndex = -1;
                  render();
                  changed();
                });
                row.addEventListener('dragend', () => { dragIndex = -1; });
                row.append(ui.pill(String(index + 1), 'plain'), ui.h('span', 'grow'), ui.h('span', '', nameOf(id)));
                if (player && !player.timeline) row.append(ui.pill(text.noTimeline, 'plain'));
                const up = ui.button(text.moveUp, { size: 'sm', onClick: () => move(index, -1) });
                const down = ui.button(text.moveDown, { size: 'sm', onClick: () => move(index, 1) });
                up.disabled = index === 0;
                down.disabled = index === order.length - 1;
                row.append(up, down);
                node.appendChild(row);
              });
            };
            render();
            return { node, read: () => order.slice() };
          }
          if (field.type === 'boolean') {
            const box = ui.checkbox(text.on, { checked: field.value === true, onChange: changed });
            return { node: box.el, read: () => box.checked };
          }
          if (field.type === 'integer' || field.type === 'number') {
            const input = ui.input({
              type: 'number',
              value: field.value == null ? '' : String(field.value),
              onChange: changed,
            });
            if (field.minimum != null) input.min = String(field.minimum);
            if (field.maximum != null) input.max = String(field.maximum);
            input.step = field.type === 'integer' ? '1' : 'any';
            return {
              node: input,
              read: () => {
                const raw = input.value.trim();
                if (raw === '') return undefined;
                const value = Number(raw);
                if (!Number.isFinite(value)) return undefined;
                return field.type === 'integer' ? Math.floor(value) : value;
              },
            };
          }
          if (field.key === 'memoryDir') {
            const wrap = ui.h('div');
            wrap.style.display = 'flex';
            wrap.style.gap = '6px';
            wrap.style.alignItems = 'center';
            const input = ui.input({
              type: 'text',
              value: field.value == null ? '' : String(field.value),
              onChange: changed,
            });
            input.style.flex = '1';
            input.placeholder = zh ? '留空＝跟本机；填同步盘文件夹' : 'Empty = local; or a synced folder';
            const pick = ui.button(zh ? '选择文件夹' : 'Choose folder', { size: 'sm', onClick: async () => {
              try {
                const picked = await ctx.pickPath({
                  kind: 'directory',
                  title: zh ? '选择记忆保存位置' : 'Choose memory folder',
                  currentPath: input.value.trim() || undefined,
                });
                if (!picked) return;
                input.value = picked;
                changed();
              } catch (e) {
                invalid(e instanceof Error ? e.message : String(e));
              }
            } });
            wrap.append(input, pick);
            return { node: wrap, read: () => input.value.trim() };
          }
          if (field.type === 'string') {
            const input = ui.input({
              type: 'text',
              value: field.value == null ? '' : String(field.value),
              onChange: changed,
            });
            return { node: input, read: () => input.value };
          }
          return { node: ui.h('span', 'tdesc', String(field.value ?? '')), read: null };
        };

        const load = async () => {
          for (const timer of timers.values()) timer.dispose();
          timers.clear();
          status.classList.remove('bad');
          status.textContent = '';
          let payload;
          try {
            payload = await ctx.invoke('read');
          } catch (e) {
            invalid(text.loadFailed(e instanceof Error ? e.message : String(e)));
            return;
          }
          if (ctx.signal.aborted) return;
          groups = (Array.isArray(payload?.groups) ? payload.groups : []).map(group => ({ ...group, readers: [] }));
          host.replaceChildren();
          for (const group of groups) {
            const sheet = ui.foldSheet(`settings-${group.kind}`, {
              title: group.title, desc: group.description || undefined,
            });
            group.sheet = sheet;
            for (const field of group.fields) {
              const row = ui.h('div', 'trow');
              const label = ui.h('span', 'tlabel', field.title);
              if (!field.hot) label.appendChild(ui.h('span', 'ttag', text.restart));
              const fieldWrap = ui.h('div', 'tfield');
              const built = control(group, field);
              fieldWrap.appendChild(built.node);
              row.append(label, fieldWrap, ui.h('span', 'tdesc', field.description || ''));
              sheet.body.appendChild(row);
              if (built.read) {
                group.readers.push({
                  key: field.key, title: field.title, type: field.type,
                  minimum: field.minimum, maximum: field.maximum, read: built.read,
                });
              }
            }
            sheet.note.textContent = summary(group);
            host.appendChild(sheet.el);
          }
          if (!groups.length) host.appendChild(ui.placeholder(text.empty));
        };

        void load();
      },
    },
    'connection-check': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const text = {
          recheck: zh ? '重新检测' : 'Recheck',
          checking: zh ? '正在检测…' : 'Checking…',
          installed: zh ? '已安装' : 'Installed',
          missing: zh ? '未安装' : 'Not installed',
          running: zh ? '运行中' : 'Running',
          stopped: zh ? '未运行' : 'Not running',
          connected: zh ? 'SMTC 已连接' : 'SMTC connected',
          disconnected: zh ? '未检测到 SMTC' : 'No SMTC session',
          supported: zh ? '官方支持' : 'Supported',
          unsupported: zh ? '未支持' : 'Unsupported',
          readingNow: zh ? '正在读取' : 'Reading now',
          sessions: zh ? '当前 SMTC 会话' : 'SMTC sessions',
          sessionsDesc: zh ? 'Windows 当前暴露的媒体会话，未匹配到官方播放器时也会列在这里' : 'Media sessions Windows currently exposes, including apps outside the official players',
          empty: zh ? '当前没有可用的 SMTC 会话' : 'No SMTC session available',
          checked: time => zh ? `检测于 ${time}，仅读取本机进程、安装信息与 SMTC 会话。` : `Checked ${time}; local processes, installs and SMTC sessions only.`,
          failed: msg => zh ? `检测失败：${msg}` : `Check failed: ${msg}`,
          notInstalled: zh ? '未检测到安装。安装后在音乐软件中开启 SMTC，播放一首歌再重新检测。' : 'Not installed. Install it, enable SMTC in the music app, play a track and recheck.',
          notRunning: zh ? '已安装但当前未运行。打开音乐软件并播放一首歌后重新检测。' : 'Installed but not running. Open the music app, play a track and recheck.',
          connectedHint: zh ? '已检测到 SMTC 会话。如果「实时状态」仍显示无曲目，请检查「设置」里的媒体会话应用名匹配。' : 'An SMTC session is visible. If Live status still shows no track, check the media session app pattern in Settings.',
          qqHint: zh ? '在 QQ 音乐「设置 → 常规设置 → 通知」勾选「显示系统媒体传输控件（SMTC）」，然后重启 QQ 音乐再检测。' : 'In QQ Music, open Settings → General → Notifications and enable "Show system media transport controls (SMTC)", then restart QQ Music and recheck.',
          neteaseHint: zh ? '网易云音乐较新版本默认开启 SMTC。若未检测到，请更新到最新版，并在设置中查找「系统媒体控制 / SMTC」相关选项，重启客户端后再检测。' : 'Recent NetEase Cloud Music versions enable SMTC by default. If no session appears, update the client, look for a system media / SMTC option in its settings, then restart and recheck.',
        };

        const bar = ui.rowbar();
        const status = ui.msgline('');
        const summary = ui.h('div');
        const appsHost = ui.h('div');
        const sessions = ui.table({
          head: zh ? ['应用', '状态', '曲目', '歌手', '支持'] : ['App', 'State', 'Track', 'Artist', 'Support'],
          maxHeight: '28vh',
        });
        const sessionSection = ui.section(text.sessions, text.sessionsDesc);
        sessionSection.append(sessions.el);
        bar.append(ui.h('span', 'grow'), ui.button(text.recheck, { size: 'sm', onClick: () => void load() }));
        ctx.root.append(bar, summary, appsHost, sessionSection, status);

        let state = { apps: [], sessions: [], error: '', currentPlayer: null, currentTrack: '' };

        const appName = app => (zh ? app.label : app.labelEn) || app.name || app.id;
        const hasSession = app => (state.sessions || []).some(session => session.player === app.id);
        const stateLabel = value => {
          const name = String(value || '').toLowerCase();
          if (name === 'playing') return zh ? '播放中' : 'Playing';
          if (name === 'paused') return zh ? '已暂停' : 'Paused';
          if (name === 'stopped') return zh ? '已停止' : 'Stopped';
          return value || '-';
        };
        const hint = app => {
          if (!app.installed) return text.notInstalled;
          if (!app.running) return text.notRunning;
          if (hasSession(app)) return text.connectedHint;
          return (zh ? app.note : app.noteEn) || text.neteaseHint;
        };

        const draw = data => {
          state = {
            apps: Array.isArray(data?.apps) ? data.apps : [],
            sessions: Array.isArray(data?.sessions) ? data.sessions : [],
            error: data?.error ? String(data.error) : '',
            currentPlayer: data?.currentPlayer ? String(data.currentPlayer) : null,
            currentTrack: data?.currentTrack ? String(data.currentTrack) : '',
          };
          summary.replaceChildren(ui.statgrid([
            { k: text.installed, v: state.apps.filter(app => app.installed).length, unit: zh ? '个' : '', accent: true },
            { k: text.running, v: state.apps.filter(app => app.running).length, unit: zh ? '个' : '' },
            { k: text.sessions, v: state.sessions.length, unit: zh ? '个' : '' },
          ]));
          appsHost.replaceChildren();
          for (const app of state.apps) {
            const linked = hasSession(app);
            const sheet = ui.sheet({ title: appName(app), desc: app.version ? `${zh ? '版本' : 'Version'} ${app.version}` : undefined });
            const pills = ui.rowbar();
            pills.append(
              ui.pill(app.installed ? text.installed : text.missing, app.installed ? 'on' : 'plain'),
              ui.pill(app.running ? text.running : text.stopped, app.running ? 'on' : 'plain'),
              ui.pill(linked ? text.connected : text.disconnected, linked ? 'on' : 'off'),
            );
            if (state.currentPlayer === app.id) pills.append(ui.pill(text.readingNow, 'on'));
            sheet.body.appendChild(pills);
            if (app.path) sheet.body.appendChild(ui.h('div', 'tdesc', String(app.path)));
            const capability = zh ? app.note : app.noteEn;
            if (capability) sheet.body.appendChild(ui.h('div', 'tdesc', capability));
            sheet.body.appendChild(ui.h('div', 'tdesc', hint(app)));
            appsHost.appendChild(sheet.el);
          }
          sessions.clear(state.sessions.length ? '' : text.empty);
          for (const session of state.sessions) {
            sessions.addRow([session.app || '-', stateLabel(session.status), session.title || '-', session.artist || '-',
              session.supported ? text.supported : text.unsupported]);
          }
          if (state.error) {
            status.classList.add('bad');
            status.textContent = text.failed(state.error);
          } else {
            status.classList.remove('bad');
            status.textContent = text.checked(new Date().toLocaleTimeString());
          }
        };

        const load = async () => {
          status.classList.remove('bad');
          status.textContent = text.checking;
          try {
            draw(await ctx.invoke('status'));
          } catch (e) {
            status.classList.add('bad');
            status.textContent = text.failed(e instanceof Error ? e.message : String(e));
          }
        };

        void load();
      },
    },
    'reader-diagnostics': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const text = {
          refresh: zh ? '刷新' : 'Refresh',
          restart: zh ? '重启读取器' : 'Restart reader',
          restarting: zh ? '正在重启读取器…' : 'Restarting reader…',
          restarted: zh ? '读取器已重启' : 'Reader restarted',
          checking: zh ? '正在读取…' : 'Reading…',
          checked: time => zh ? `读取于 ${time}` : `Read at ${time}`,
          failed: msg => zh ? `读取失败：${msg}` : `Read failed: ${msg}`,
          reader: zh ? '读取器' : 'Reader',
          running: zh ? '运行中' : 'Running',
          stopped: zh ? '未运行' : 'Stopped',
          sessions: zh ? 'SMTC 会话' : 'SMTC sessions',
          windows: zh ? '窗口候选' : 'Window candidates',
          reading: zh ? '读取状态' : 'Reading',
          track: zh ? '当前曲目' : 'Track',
          player: zh ? '播放器' : 'Player',
          source: zh ? '来源' : 'Source',
          observed: zh ? '最近观测' : 'Observed',
          updated: zh ? '诊断更新时间' : 'Diagnostics updated',
          priority: zh ? '优先级' : 'Priority',
          priorityDesc: zh ? '靠前的播放器优先；当前播放器仍在播放时会有短暂粘性' : 'Earlier players win; the current player keeps short stickiness while still playing',
          selection: zh ? '本次选择' : 'Selection',
          selected: zh ? '选中' : 'Selected',
          reason: zh ? '原因' : 'Reason',
          sticky: zh ? '粘性' : 'Sticky',
          pending: zh ? '待切换' : 'Pending switch',
          none: zh ? '无' : 'None',
          timeline: zh ? '有时间轴' : 'Timeline',
          noTimeline: zh ? '无进度' : 'No timeline',
          emptySessions: zh ? '没有官方播放器的 SMTC 会话' : 'No official-player SMTC session',
          emptyWindows: zh ? '没有窗口标题候选' : 'No window-title candidate',
          currentEmpty: zh ? '尚未读取到当前曲目' : 'No current track yet',
          invalid: ids => zh
            ? `检测到无法识别的播放器标识：${ids}。通常是读取脚本与播放器清单不同步，可重启读取器或重新安装插件。`
            : `Unrecognized player ids: ${ids}. The reader script may be out of sync; restart the reader or reinstall the plugin.`,
        };
        const reasonLabel = reason => {
          const labels = {
            sticky: zh ? '保持当前播放器（粘性）' : 'Keep current player (sticky)',
            'priority-playing': zh ? '按优先级选择正在播放的会话' : 'Priority picked a playing session',
            'priority-paused': zh ? '按优先级选择暂停会话' : 'Priority picked a paused session',
            'window-sticky': zh ? '保持当前窗口标题来源' : 'Keep current window-title source',
            'window-priority': zh ? '按优先级选择窗口标题' : 'Priority picked a window title',
          };
          return labels[reason] || reason || text.none;
        };

        const bar = ui.rowbar();
        const status = ui.msgline('');
        const warning = ui.msgline('');
        const summary = ui.h('div');
        const currentHost = ui.h('div');
        const priorityRow = ui.rowbar();
        const selectionHost = ui.h('div');
        const sessions = ui.table({
          head: zh ? ['播放器', '应用', '状态', '曲目', '歌手', '时间轴'] : ['Player', 'App', 'State', 'Track', 'Artist', 'Timeline'],
          maxHeight: '24vh',
        });
        const windows = ui.table({
          head: zh ? ['播放器', '进程', '窗口标题'] : ['Player', 'Process', 'Window title'],
          maxHeight: '18vh',
        });
        const sessionSection = ui.section(text.sessions, text.priorityDesc);
        const windowSection = ui.section(text.windows);
        sessionSection.append(priorityRow, sessions.el);
        windowSection.append(windows.el);
        const refresh = ui.button(text.refresh, { size: 'sm', onClick: () => void load() });
        const restart = ui.button(text.restart, { size: 'sm', onClick: () => void restartReader() });
        bar.append(ui.h('span', 'grow'), refresh, restart);
        ctx.root.append(bar, summary, currentHost, sessionSection, windowSection, selectionHost, warning, status);

        const playerName = (priority, id) => {
          const player = (priority || []).find(item => item.id === id);
          return player ? (zh ? player.label : player.labelEn) : (id || '-');
        };
        const stateLabel = value => {
          const name = String(value || '').toLowerCase();
          if (name === 'playing') return zh ? '播放中' : 'Playing';
          if (name === 'paused') return zh ? '已暂停' : 'Paused';
          if (name === 'stopped') return zh ? '已停止' : 'Stopped';
          return value || '-';
        };
        const draw = data => {
          const reader = data?.reader && data.reader.status !== 'unavailable' ? data.reader : null;
          const priority = Array.isArray(data?.priority) ? data.priority : [];
          const sessionRows = Array.isArray(reader?.sessions) ? reader.sessions : [];
          const windowRows = Array.isArray(reader?.windows) ? reader.windows : [];
          summary.replaceChildren(ui.statgrid([
            { k: text.reader, v: reader ? (reader.running ? text.running : text.stopped) : text.stopped, accent: true },
            { k: text.sessions, v: sessionRows.length, unit: zh ? '个' : '' },
            { k: text.windows, v: windowRows.length, unit: zh ? '个' : '' },
          ]));
          const current = data?.current;
          currentHost.replaceChildren(current ? ui.kv([
            { k: text.reading, v: data.reading || '-' },
            { k: text.track, v: `${current.title}${current.artist ? ' - ' + current.artist : ''}` },
            { k: text.player, v: current.playerLabel || playerName(priority, current.player) },
            { k: text.source, v: current.method || '-' },
            { k: text.observed, v: data.observedAt ? new Date(data.observedAt).toLocaleTimeString() : '-' },
            { k: text.updated, v: reader?.updatedAt ? new Date(reader.updatedAt).toLocaleTimeString() : '-' },
          ]) : ui.placeholder(text.currentEmpty));

          priorityRow.replaceChildren();
          for (const [index, item] of priority.entries()) {
            const pill = ui.pill(`${index + 1} ${zh ? item.label : item.labelEn}`, 'plain');
            priorityRow.append(pill);
            if (!item.timeline) priorityRow.append(ui.pill(text.noTimeline, 'plain'));
          }
          if (!priority.length) priorityRow.append(ui.pill(text.none, 'plain'));

          sessions.clear(sessionRows.length ? '' : text.emptySessions);
          for (const session of sessionRows) {
            sessions.addRow([
              playerName(priority, session.player), session.app || '-', stateLabel(session.status),
              session.title || '-', session.artist || '-', session.timeline ? text.timeline : text.noTimeline,
            ]);
          }
          windows.clear(windowRows.length ? '' : text.emptyWindows);
          for (const window of windowRows) {
            windows.addRow([playerName(priority, window.player), window.app || '-', window.title || '-']);
          }
          const selection = reader?.selection;
          const selector = reader?.selector || {};
          selectionHost.replaceChildren(ui.kv([
            { k: text.selected, v: selection ? `${playerName(priority, selection.player)} · ${selection.app}` : text.none },
            { k: text.reason, v: reasonLabel(selection?.reason) },
            { k: text.sticky, v: selector.sticky ? `${playerName(priority, selector.sticky.player)} · ${selector.sticky.app}（${selector.sticky.method}）` : text.none },
            { k: text.pending, v: selector.pending ? `${playerName(priority, selector.pending.player)} · ${selector.pending.app}（${selector.pending.count}）` : text.none },
          ]));
          const invalid = Array.isArray(reader?.invalidPlayers) ? reader.invalidPlayers : [];
          if (invalid.length) {
            warning.classList.add('bad');
            warning.textContent = text.invalid(invalid.join('、'));
          } else {
            warning.classList.remove('bad');
            warning.textContent = '';
          }
          if (data?.error) {
            status.classList.add('bad');
            status.textContent = text.failed(data.error);
          } else {
            status.classList.remove('bad');
            status.textContent = text.checked(new Date().toLocaleTimeString());
          }
        };

        const load = async () => {
          status.classList.remove('bad');
          status.textContent = text.checking;
          try {
            draw(await ctx.invoke('snapshot'));
          } catch (e) {
            status.classList.add('bad');
            status.textContent = text.failed(e instanceof Error ? e.message : String(e));
          }
        };
        const restartReader = async () => {
          status.classList.remove('bad');
          status.textContent = text.restarting;
          restart.disabled = true;
          try {
            const result = await ctx.invoke('restart');
            status.textContent = result?.status === 'ok' ? text.restarted : text.failed(result?.reason || '');
            await load();
          } catch (e) {
            status.classList.add('bad');
            status.textContent = text.failed(e instanceof Error ? e.message : String(e));
          } finally {
            restart.disabled = false;
          }
        };

        void load();
        ctx.interval(() => void load(), 2000);
      },
    },
    'live-status': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const table = ui.h('div');
        const note = ui.msgline('');
        ctx.root.append(table, note);

        const draw = (s) => {
          table.replaceChildren(ui.kv([
            { k: zh ? '读取状态' : 'Reader', v: s.reading },
            { k: zh ? '当前曲目' : 'Track', v: s.track },
            { k: zh ? '播放状态' : 'Playback', v: s.playback },
            { k: zh ? '来源' : 'Source', v: s.method || '-' },
            { k: zh ? '陪听' : 'Commentary', v: s.commentary },
            { k: zh ? '分段陪听' : 'Segments', v: s.segments || '已关闭' },
            { k: zh ? '下一段' : 'Next segment', v: s.nextSegment || '—' },
            { k: zh ? '安静时段' : 'Quiet hours', v: s.quiet || '正常' },
            { k: zh ? '动作提示' : 'Action hints', v: s.actions || '已关闭' },
            { k: zh ? '评论区' : 'Comments', v: s.comment },
            { k: zh ? '歌手资料' : 'Artist', v: s.artist },
            { k: zh ? '歌曲背景' : 'Song', v: s.song || '未启用' },
            { k: zh ? '歌词' : 'Lyrics', v: s.lyrics || '未启用' },
            { k: zh ? '偏好记忆' : 'Preferences', v: s.preferences || '未启用' },
            { k: zh ? '互动频率' : 'Cadence', v: s.interaction || '未启用' },
            { k: zh ? '听歌记录' : 'Listening', v: s.listening || '未启用' },
            { k: zh ? '听歌口味' : 'Taste', v: s.taste || '未启用' },
            { k: zh ? '单曲笔记' : 'Notes', v: s.notes || '未启用' },
            { k: zh ? '听感/曲风' : 'Tags', v: s.tags || '未启用' },
            { k: zh ? '本次已请求评论' : 'Requests', v: String(s.requests) },
          ]));
          note.textContent = s.observedAt
            ? (zh ? `最近观测 ${new Date(s.observedAt).toLocaleTimeString()}` : `Observed ${new Date(s.observedAt).toLocaleTimeString()}`)
            : (zh ? '尚未观测到播放状态' : 'No observation yet');
          note.classList.remove('bad');
        };

        const tick = async () => {
          try {
            draw(await ctx.invoke('snapshot'));
          } catch (e) {
            note.classList.add('bad');
            note.textContent = e instanceof Error ? e.message : String(e);
          }
        };

        void tick();
        ctx.interval(() => void tick(), 2000);
      },
    },
    'listening-ranking': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        let view = 'tracks';
        let last = null;
        let draw = () => {};
        const statsHost = ui.h('div');
        const note = ui.msgline('');
        const tabs = ui.segmented([
          { value: 'tracks', label: zh ? '歌曲榜' : 'Songs' },
          { value: 'artists', label: zh ? '歌手榜' : 'Artists' },
        ], {
          value: 'tracks', size: 'sm',
          onSelect: value => { view = value; if (last) draw(last); },
        });
        const bar = ui.rowbar();
        bar.append(tabs.el, ui.chip(zh ? '按播放次数' : 'By plays', 'plain'));

        const songPodium = ui.statgrid();
        const artistPodium = ui.statgrid();
        const songs = ui.table({
          head: zh ? ['#', '歌曲', '歌手', '播放', '最近'] : ['#', 'Song', 'Artist', 'Plays', 'Last'],
          maxHeight: '38vh',
        });
        const artists = ui.table({
          head: zh ? ['#', '歌手', '播放', '最近'] : ['#', 'Artist', 'Plays', 'Last'],
          maxHeight: '30vh',
        });
        const songSection = ui.section(zh ? '常听歌曲' : 'Top songs', zh ? '前三名单独展示，其余按名次排列' : 'Top 3 highlighted, the rest ranked');
        songSection.append(songPodium, songs.el);
        const artistSection = ui.section(zh ? '常听歌手' : 'Top artists', zh ? '前三名单独展示，其余按名次排列' : 'Top 3 highlighted, the rest ranked');
        artistSection.append(artistPodium, artists.el);
        ctx.root.append(statsHost, bar, songSection, artistSection, note);

        const date = (v) => {
          const d = new Date(v);
          return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
        };
        const podium = (host, items, title, desc) => {
          host.replaceChildren();
          for (const item of items.slice(0, 3)) {
            const card = ui.sheet({ title: `#${item.rank} ${title(item)}`, desc: desc(item) });
            card.body.append(ui.stat({
              k: zh ? '播放' : 'Plays', v: item.count, unit: zh ? '次' : 'plays', accent: item.rank === 1,
            }));
            host.append(card.el);
          }
        };
        const fill = (table, items, row, empty) => {
          table.clear(items.length === 0 ? empty : items.length <= 3
            ? (zh ? '没有更多名次' : 'No more ranks')
            : (zh ? '前三名已在上方展示' : 'Top 3 shown above'));
          const max = items[0]?.count || 1;
          for (const item of items.slice(3)) {
            const rank = ui.chip(String(item.rank), 'plain');
            const plays = ui.progress({
              value: item.count, max, tone: 'plain',
              format: value => `${value} ${zh ? '次' : 'plays'}`,
            });
            table.addRow([rank, ...row(item, plays.el)]);
          }
        };
        draw = (s) => {
          last = s;
          const limits = s.limits || { tracks: 0, artists: 0, rankTracks: 0, rankArtists: 0 };
          statsHost.replaceChildren(ui.statgrid([
            { k: zh ? '总播放' : 'Total plays', v: s.totalPlays ?? 0, unit: zh ? '次' : 'plays', accent: true },
            { k: zh ? '收录歌曲' : 'Stored songs', v: s.storedTracks ?? 0, unit: zh ? '首' : 'tracks' },
            { k: zh ? '收录歌手' : 'Stored artists', v: s.storedArtists ?? 0, unit: zh ? '位' : 'artists' },
            { k: zh ? '显示范围' : 'Display range', v: limits.rankTracks, unit: zh ? `首 / ${limits.rankArtists} 位` : `songs / ${limits.rankArtists} artists` },
          ]));
          songSection.hidden = view !== 'tracks';
          artistSection.hidden = view !== 'artists';
          const tracks = s.tracks || [];
          const artistList = s.artists || [];
          podium(songPodium, tracks, t => t.title, t => `${t.artist || '-'} · ${date(t.lastAt)}`);
          podium(artistPodium, artistList, a => a.name, a => date(a.lastAt));
          fill(songs, tracks, (t, plays) => [t.title, t.artist || '-', plays, date(t.lastAt)], zh ? '还没有听歌记录' : 'No listening history yet');
          fill(artists, artistList, (a, plays) => [a.name, plays, date(a.lastAt)], zh ? '还没有歌手记录' : 'No artist history yet');
          if (s.status === 'unavailable') {
            note.classList.add('bad');
            note.textContent = zh ? '听歌记忆未启用' : 'Listening memory unavailable';
            return;
          }
          note.classList.remove('bad');
          note.textContent = zh
            ? `共 ${s.totalPlays ?? 0} 次播放 · 显示前 ${limits.rankTracks} 首 / 前 ${limits.rankArtists} 位 · 更新于 ${new Date().toLocaleTimeString()}`
            : `${s.totalPlays ?? 0} plays · top ${limits.rankTracks} songs / ${limits.rankArtists} artists · updated ${new Date().toLocaleTimeString()}`;
        };
        const tick = async () => {
          try {
            draw(await ctx.invoke('snapshot'));
          } catch (e) {
            note.classList.add('bad');
            note.textContent = e instanceof Error ? e.message : String(e);
          }
        };
        void tick();
        ctx.interval(() => void tick(), 5000);
      },
    },
    'profile-analysis': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        let windowValue = '90';
        let refresh = async () => {};
        let lastSnapshot = null;
        let monthValue = (() => {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        })();
        let monthData = null;
        let dayData = null;
        let selectedDate = '';
        let loadMonth = async () => {};
        const note = ui.msgline('');
        const windows = ui.segmented([
          { value: '7', label: zh ? '7 天' : '7d' },
          { value: '30', label: zh ? '30 天' : '30d' },
          { value: '90', label: zh ? '90 天' : '90d' },
          { value: 'all', label: zh ? '全部' : 'All' },
        ], {
          value: '90', size: 'sm',
          onSelect: value => { windowValue = value; void refresh(); },
        });
        const bar = ui.rowbar();
        const exportJson = ui.button(zh ? '导出 JSON' : 'Export JSON', { size: 'sm', onClick: () => exportData('json') });
        const exportCsv = ui.button(zh ? '导出 CSV' : 'Export CSV', { size: 'sm', onClick: () => exportData('csv') });
        bar.append(windows.el, ui.chip(zh ? '从听歌记录汇总' : 'From listening log', 'plain'), ui.h('span', 'grow'), exportJson, exportCsv);

        const statsHost = ui.h('div');
        const hourChart = ui.h('div');
        const dayChart = ui.h('div');
        const monthBar = ui.rowbar();
        const dayDetail = ui.h('div');
        const artistTable = ui.table({ head: zh ? ['#', '歌手', '播放'] : ['#', 'Artist', 'Plays'], maxHeight: '26vh' });
        const genreTable = ui.table({ head: zh ? ['#', '曲风', '播放', '占比'] : ['#', 'Genre', 'Plays', 'Share'], maxHeight: '26vh' });
        const repeatTable = ui.table({ head: zh ? ['#', '歌曲', '歌手', '播放'] : ['#', 'Song', 'Artist', 'Plays'], maxHeight: '26vh' });
        const playerTable = ui.table({ head: zh ? ['播放器', '播放', '占比', '活跃天数', '最近', '常听歌手'] : ['Player', 'Plays', 'Share', 'Days', 'Last', 'Top artists'], maxHeight: '24vh' });
        const playerPie = ui.h('div');
        const genrePie = ui.h('div');
        const playerLegend = ui.h('div');
        const playerHost = ui.h('div');
        const tasteHost = ui.h('div');

        const hourSheet = ui.foldSheet('profile-hours', { title: zh ? '时段分布' : 'Listening hours', desc: zh ? '按 24 小时汇总播放次数，不做人格判断' : 'Plays by hour of day', defaultOpen: true });
        hourSheet.body.append(hourChart);
        const daySheet = ui.foldSheet('profile-days', { title: zh ? '每日播放' : 'Daily plays', desc: zh ? '按日历显示每天的播放次数，颜色越深播放越多，悬停可看日期与次数；点击某天查看当天曲目' : 'Calendar of daily play counts; darker means more plays, hover for date and count, click a day for its tracks', defaultOpen: true });
        daySheet.body.append(monthBar, dayChart, dayDetail);
        const artistSheet = ui.foldSheet('profile-artists', { title: zh ? '常听歌手' : 'Top artists', desc: zh ? '所选窗口内的播放次数' : 'Within the selected window', defaultOpen: true });
        artistSheet.body.append(artistTable.el);
        const genreSheet = ui.foldSheet('profile-genres', { title: zh ? '常听曲风' : 'Top genres', desc: zh ? '饼图取前五，列表从歌曲百科曲风与手动标签汇总；多标签曲风会重复计入' : 'Pie shows the top five; list from song wiki genres and manual tags; multi-genre tracks count in each genre', defaultOpen: true });
        genrePie.style.width = '150px';
        genrePie.style.height = '150px';
        genrePie.style.borderRadius = '50%';
        genrePie.style.flex = '0 0 auto';
        genrePie.style.transition = 'transform .55s ease, opacity .55s ease';
        const genreChart = ui.h('div');
        genreChart.style.display = 'flex';
        genreChart.style.flexWrap = 'wrap';
        genreChart.style.alignItems = 'center';
        genreChart.style.gap = '18px';
        const genreTableWrap = ui.h('div');
        genreTableWrap.style.flex = '1';
        genreTableWrap.style.minWidth = '220px';
        genreTableWrap.append(genreTable.el);
        genreChart.append(genrePie, genreTableWrap);
        genreSheet.body.append(genreChart);
        const repeatSheet = ui.foldSheet('profile-repeat', { title: zh ? '循环曲' : 'Repeat tracks', desc: zh ? '窗口内播放两次以上' : 'Played at least twice', defaultOpen: true });
        repeatSheet.body.append(repeatTable.el);
        const playerSheet = ui.foldSheet('profile-players', { title: zh ? '播放器占比' : 'Player share', desc: zh ? '按播放次数占比' : 'Share by plays', defaultOpen: true });
        playerHost.style.display = 'flex';
        playerHost.style.flexWrap = 'wrap';
        playerHost.style.alignItems = 'center';
        playerHost.style.gap = '18px';
        playerPie.style.width = '150px';
        playerPie.style.height = '150px';
        playerPie.style.borderRadius = '50%';
        playerPie.style.flex = '0 0 auto';
        playerPie.style.transition = 'transform .55s ease, opacity .55s ease';
        playerLegend.style.display = 'flex';
        playerLegend.style.flexDirection = 'column';
        playerLegend.style.gap = '7px';
        playerLegend.style.minWidth = '180px';
        playerLegend.style.flex = '1';
        playerHost.append(playerPie, playerLegend);
        playerSheet.body.append(playerHost);
        const breakdownSheet = ui.foldSheet('profile-player-breakdown', { title: zh ? '播放器拆分' : 'Per-player breakdown', desc: zh ? '按客户端汇总播放次数、活跃天数与常听歌手；旧记录没有客户端归属的播放不参与' : 'Plays, active days and top artists per client; old plays without client attribution are excluded', defaultOpen: true });
        breakdownSheet.body.append(playerTable.el);
        const tasteSheet = ui.foldSheet('profile-taste', { title: zh ? '口味画像' : 'Taste profile', desc: zh ? '只根据本机听歌记录和明确偏好，不做人格定论' : 'From local listening data and explicit preferences only', defaultOpen: true });
        tasteSheet.body.append(tasteHost);

        ctx.root.append(statsHost, bar, hourSheet.el, daySheet.el, artistSheet.el, genreSheet.el, repeatSheet.el, playerSheet.el, breakdownSheet.el, tasteSheet.el, note);

        const label = app => (app || '-').replace(/\.exe$/i, '');
        const date = value => {
          const d = new Date(`${value}T00:00:00`);
          return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
        };
        const bars = (table, items, row, empty) => {
          table.clear(items.length ? '' : empty);
          const max = Math.max(1, ...items.map(item => item.count));
          for (const item of items) {
            const progress = ui.progress({ value: item.count, max, tone: 'plain', format: value => String(value) });
            table.addRow(row(item, progress.el));
          }
        };
        const PALETTE = ['#5b8cff', '#ff8a5b', '#4cc38a', '#b07cff', '#f5c542', '#ff6b9a'];
        const drawHourChart = (host, items) => {
          host.replaceChildren();
          const wrap = ui.h('div');
          wrap.style.display = 'flex';
          wrap.style.alignItems = 'flex-end';
          wrap.style.gap = '3px';
          wrap.style.height = '160px';
          wrap.style.padding = '8px 2px 0';
          const max = Math.max(1, ...items.map(item => item.count));
          for (const item of items) {
            const col = ui.h('div');
            col.style.flex = '1';
            col.style.minWidth = '4px';
            col.style.height = '100%';
            col.style.display = 'flex';
            col.style.flexDirection = 'column';
            col.style.justifyContent = 'flex-end';
            col.style.alignItems = 'center';
            col.title = `${String(item.hour).padStart(2, '0')}:00 · ${item.count}`;
            const area = ui.h('div');
            area.style.width = '100%';
            area.style.flex = '1';
            area.style.display = 'flex';
            area.style.alignItems = 'flex-end';
            area.style.borderBottom = '1px solid rgba(128,128,128,.28)';
            const fill = ui.h('div');
            fill.style.width = '100%';
            fill.style.height = '0';
            fill.style.background = 'var(--accent, #5b8cff)';
            fill.style.borderRadius = '3px 3px 0 0';
            fill.style.transition = 'height .7s cubic-bezier(.2,.8,.2,1)';
            area.append(fill);
            const lab = ui.h('div');
            lab.textContent = item.hour % 3 === 0 ? String(item.hour) : '';
            lab.style.height = '14px';
            lab.style.lineHeight = '14px';
            lab.style.fontSize = '9px';
            lab.style.opacity = '.55';
            lab.style.whiteSpace = 'nowrap';
            col.append(area, lab);
            wrap.append(col);
            requestAnimationFrame(() => {
              fill.style.height = `${Math.round((item.count / max) * 100)}%`;
            });
          }
          host.append(wrap);
        };
        const dayKey = value => {
          const d = new Date(value);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const drawCalendar = (host, daily, days, zh) => {
          host.replaceChildren();
          const plays = new Map((daily || []).map(item => [item.date, item.plays || 0]));
          if (!plays.size) {
            host.append(ui.h('div', 'tdesc', zh ? '还没有逐日记录' : 'No daily data yet'));
            return;
          }
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const start = new Date(today);
          start.setDate(start.getDate() - Math.max(1, days) + 1);
          const gridStart = new Date(start);
          gridStart.setDate(gridStart.getDate() - gridStart.getDay());
          const gridEnd = new Date(today);
          gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
          const weeks = Math.max(1, Math.round((gridEnd - gridStart) / 604_800_000) + 1);
          const max = Math.max(1, ...plays.values());
          const level = count => {
            if (!count) return 0;
            if (count <= max * 0.25) return 1;
            if (count <= max * 0.5) return 2;
            if (count <= max * 0.75) return 3;
            return 4;
          };
          const opacity = [0.18, 0.38, 0.62, 0.82, 1];
          const box = ui.h('div');
          box.style.display = 'flex';
          box.style.flexDirection = 'column';
          box.style.gap = '4px';
          box.style.overflowX = 'auto';
          box.style.padding = '2px 0 4px';
          const monthRow = ui.h('div');
          monthRow.style.display = 'grid';
          monthRow.style.gridTemplateColumns = `repeat(${weeks}, 12px)`;
          monthRow.style.gap = '3px';
          monthRow.style.height = '16px';
          monthRow.style.marginLeft = '18px';
          let lastMonth = -1;
          for (let week = 0; week < weeks; ++week) {
            const cell = ui.h('div');
            const first = new Date(gridStart);
            first.setDate(first.getDate() + week * 7);
            if (first < start) first.setTime(start.getTime());
            const month = first.getMonth();
            if (month !== lastMonth) {
              lastMonth = month;
              cell.textContent = `${month + 1} ${zh ? '月' : 'mo'}`;
              cell.style.fontSize = '9px';
              cell.style.opacity = '.6';
              cell.style.whiteSpace = 'nowrap';
            }
            monthRow.append(cell);
          }
          const body = ui.h('div');
          body.style.display = 'flex';
          body.style.gap = '4px';
          const weekdays = ui.h('div');
          weekdays.style.display = 'grid';
          weekdays.style.gridTemplateRows = 'repeat(7, 12px)';
          weekdays.style.gap = '3px';
          weekdays.style.width = '14px';
          for (let row = 0; row < 7; ++row) {
            const label = ui.h('div');
            label.textContent = row === 1 ? (zh ? '一' : 'M') : row === 3 ? (zh ? '三' : 'W') : row === 5 ? (zh ? '五' : 'F') : '';
            label.style.fontSize = '9px';
            label.style.lineHeight = '12px';
            label.style.opacity = '.5';
            label.style.textAlign = 'right';
            weekdays.append(label);
          }
          const grid = ui.h('div');
          grid.style.display = 'grid';
          grid.style.gridAutoFlow = 'column';
          grid.style.gridTemplateRows = 'repeat(7, 12px)';
          grid.style.gridTemplateColumns = `repeat(${weeks}, 12px)`;
          grid.style.gap = '3px';
          const cells = weeks * 7;
          for (let index = 0; index < cells; ++index) {
            const cell = ui.h('div');
            cell.style.width = '12px';
            cell.style.height = '12px';
            cell.style.borderRadius = '2px';
            cell.style.background = 'rgba(128,128,128,.14)';
            const date = new Date(gridStart);
            date.setDate(date.getDate() + index);
            if (date < start || date > today) {
              cell.style.visibility = 'hidden';
            } else {
              const key = dayKey(date);
              const count = plays.get(key) || 0;
              if (count) {
                cell.style.background = 'var(--accent, #5b8cff)';
                cell.style.opacity = String(opacity[level(count)]);
                cell.title = `${key} · ${count} ${zh ? '次' : 'plays'}`;
              } else {
                cell.title = `${key} · ${zh ? '没有播放' : 'no plays'}`;
              }
            }
            grid.append(cell);
          }
          body.append(weekdays, grid);
          const legend = ui.h('div');
          legend.style.display = 'flex';
          legend.style.alignItems = 'center';
          legend.style.gap = '4px';
          legend.style.justifyContent = 'flex-end';
          legend.style.fontSize = '9px';
          legend.style.opacity = '.6';
          legend.append(ui.h('span', '', zh ? '少' : 'Less'));
          for (let i = 0; i < 5; ++i) {
            const dot = ui.h('div');
            dot.style.width = '10px';
            dot.style.height = '10px';
            dot.style.borderRadius = '2px';
            dot.style.background = i === 0 ? 'rgba(128,128,128,.14)' : 'var(--accent, #5b8cff)';
            dot.style.opacity = i === 0 ? '1' : String(opacity[i]);
            legend.append(dot);
          }
          legend.append(ui.h('span', '', zh ? '多' : 'More'));
          box.append(monthRow, body, legend);
          host.append(box);
        };
        const drawMonthCalendar = (host, month, days, selected, onPick) => {
          host.replaceChildren();
          const [year, monthNumber] = String(month || '').split('-').map(Number);
          if (!year || !monthNumber) return;
          const plays = new Map((days || []).map(item => [item.date, item.plays || 0]));
          const first = new Date(year, monthNumber - 1, 1);
          const total = new Date(year, monthNumber, 0).getDate();
          const max = Math.max(1, ...plays.values());
          const level = count => {
            if (!count) return 0;
            if (count <= max * 0.25) return 1;
            if (count <= max * 0.5) return 2;
            if (count <= max * 0.75) return 3;
            return 4;
          };
          const percent = [0, 22, 38, 58, 82];
          const wrap = ui.h('div');
          wrap.style.maxWidth = '430px';
          const head = ui.h('div');
          head.style.display = 'grid';
          head.style.gridTemplateColumns = 'repeat(7, minmax(30px, 1fr))';
          head.style.gap = '4px';
          head.style.marginBottom = '4px';
          for (const name of zh ? ['日', '一', '二', '三', '四', '五', '六'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
            const cell = ui.h('div', '', name);
            cell.style.fontSize = '9px';
            cell.style.opacity = '.5';
            cell.style.textAlign = 'center';
            head.append(cell);
          }
          const grid = ui.h('div');
          grid.style.display = 'grid';
          grid.style.gridTemplateColumns = 'repeat(7, minmax(30px, 1fr))';
          grid.style.gap = '4px';
          for (let i = 0; i < first.getDay(); ++i) grid.append(ui.h('div'));
          const now = new Date();
          const todayKey = dayKey(now);
          for (let day = 1; day <= total; ++day) {
            const date = `${month}-${String(day).padStart(2, '0')}`;
            const count = plays.get(date) || 0;
            const cell = ui.h('div');
            cell.style.minHeight = '42px';
            cell.style.borderRadius = '5px';
            cell.style.padding = '4px';
            cell.style.background = 'rgba(128,128,128,.10)';
            if (count) cell.style.background = `color-mix(in srgb, var(--accent, #5b8cff) ${percent[level(count)]}%, transparent)`;
            if (date === todayKey) cell.style.border = '1px solid rgba(128,128,128,.45)';
            if (date === selected) {
              cell.style.outline = '1px solid var(--accent, #5b8cff)';
              cell.style.outlineOffset = '1px';
            }
            cell.style.cursor = 'pointer';
            cell.title = `${date} · ${count} ${zh ? '次' : 'plays'}`;
            const number = ui.h('div', '', String(day));
            number.style.fontSize = '10px';
            number.style.opacity = '.72';
            const value = ui.h('div', '', count ? String(count) : '');
            value.style.fontSize = '9px';
            value.style.opacity = '.55';
            value.style.textAlign = 'right';
            cell.append(number, value);
            cell.addEventListener('click', () => onPick(date));
            grid.append(cell);
          }
          wrap.append(head, grid);
          host.append(wrap);
        };
        const drawDayDetail = (host, day, zh) => {
          host.replaceChildren();
          if (!day || day.status === 'empty' || !day.date) {
            host.append(ui.h('div', 'tdesc', zh ? '点击日历中的日期查看当天曲目' : 'Click a date in the calendar to see its tracks'));
            return;
          }
          host.append(ui.h('div', 'tdesc', `${day.date} · ${day.plays ?? 0} ${zh ? '次播放' : 'plays'}`));
          const table = ui.table({ head: zh ? ['歌曲', '歌手', '专辑', '播放'] : ['Track', 'Artist', 'Album', 'Plays'], maxHeight: '22vh' });
          const tracks = [...(day.tracks || [])].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
          table.clear(tracks.length ? '' : (zh ? '这一天没有曲目明细' : 'No track detail for this day'));
          for (const track of tracks) table.addRow([track.title || '-', track.artist || '-', track.album || '-', track.count]);
          host.append(table.el);
          const players = (day.players || []).filter(item => item.app && item.app !== 'unknown')
            .map(item => `${label(item.app)} ${item.count}`).join(' · ');
          if (players) host.append(ui.h('div', 'tdesc', `${zh ? '客户端' : 'Clients'}：${players}`));
        };
        const drawPie = players => {
          playerLegend.replaceChildren();
          if (!players.length) {
            playerPie.style.background = '#8883';
            playerPie.style.opacity = '.35';
            playerPie.style.transform = 'scale(1)';
            playerLegend.append(ui.h('div', 'tdesc', zh ? '还没有播放器记录' : 'No player data yet'));
            return;
          }
          let start = 0;
          const stops = [];
          players.forEach((item, index) => {
            const from = start;
            const to = start + (item.share || 0) * 100;
            stops.push(`${PALETTE[index % PALETTE.length]} ${from}% ${to}%`);
            start = to;
          });
          if (start < 100) stops.push(`#8883 ${start}% 100%`);
          playerPie.style.background = `conic-gradient(${stops.join(', ')})`;
          playerPie.style.opacity = '0';
          playerPie.style.transform = 'scale(.85)';
          requestAnimationFrame(() => {
            playerPie.style.opacity = '1';
            playerPie.style.transform = 'scale(1)';
          });
          players.forEach((item, index) => {
            const row = ui.h('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            const dot = ui.h('span');
            dot.style.width = '10px';
            dot.style.height = '10px';
            dot.style.borderRadius = '50%';
            dot.style.background = PALETTE[index % PALETTE.length];
            const name = ui.h('span');
            name.textContent = label(item.app);
            name.style.flex = '1';
            const value = ui.h('span');
            value.textContent = `${item.count} · ${Math.round((item.share || 0) * 100)}%`;
            value.style.opacity = '.65';
            row.append(dot, name, value);
            playerLegend.append(row);
          });
        };
        const drawGenrePie = genres => {
          const top = genres.slice(0, 5);
          if (!top.length) {
            genrePie.style.background = '#8883';
            genrePie.style.opacity = '.35';
            genrePie.style.transform = 'scale(1)';
            return;
          }
          const total = top.reduce((sum, item) => sum + (item.share || 0), 0) || 1;
          let start = 0;
          const stops = [];
          top.forEach((item, index) => {
            const from = start;
            const to = start + ((item.share || 0) / total) * 100;
            stops.push(`${PALETTE[index % PALETTE.length]} ${from}% ${to}%`);
            start = to;
          });
          if (start < 100) stops.push(`#8883 ${start}% 100%`);
          genrePie.style.background = `conic-gradient(${stops.join(', ')})`;
          genrePie.style.opacity = '0';
          genrePie.style.transform = 'scale(.85)';
          requestAnimationFrame(() => {
            genrePie.style.opacity = '1';
            genrePie.style.transform = 'scale(1)';
          });
        };
        const draw = s => {
          lastSnapshot = s;
          const cumulative = s.scope === 'cumulative';
          const mixed = s.scope === 'mixed';
          const topArtist = s.topArtists?.[0];
          const topGenre = s.topGenres?.[0];
          const topPlayer = s.players?.[0];
          statsHost.replaceChildren(ui.statgrid([
            { k: zh ? (cumulative ? '累计播放' : '总播放') : (cumulative ? 'All-time plays' : 'Total plays'), v: s.totalPlays ?? 0, unit: zh ? '次' : 'plays', accent: true },
            { k: zh ? '记录天数' : 'Recorded days', v: cumulative ? '—' : s.recordedDays ?? 0, unit: cumulative ? undefined : (zh ? '天' : 'days') },
            { k: zh ? '常听歌手' : 'Top artist', v: topArtist?.name || '—' },
            { k: zh ? '常听曲风' : 'Top genre', v: topGenre?.name || '—' },
            { k: zh ? '常用播放器' : 'Top player', v: topPlayer ? label(topPlayer.app) : '—' },
          ]));
          if (cumulative) {
            statsHost.append(ui.h('div', 'tdesc', zh
              ? '逐日记录从本次更新后开始：总播放、常听歌手、循环曲与曲风来自之前的累计排名；时段、每日与播放器图表会随新播放逐步补齐。'
              : 'Per-day logging starts with this update: totals, top artists, repeat tracks and genres come from earlier cumulative ranking; hour, daily and player charts fill in as new plays are logged.'));
          } else if (mixed) {
            statsHost.append(ui.h('div', 'tdesc', zh
              ? `其中 ${s.earlierPlays ?? 0} 次播放来自更新前的累计记录，没有逐日日期；总播放、常听歌手、循环曲与曲风已合并，时段、每日与播放器图表只统计更新后的记录；曲风占比只统计有曲风标签的播放。`
              : `${s.earlierPlays ?? 0} plays come from pre-update cumulative records without per-day dates; totals, top artists, repeat tracks and genres are merged, while hour, daily and player charts only count records after the update; genre shares only count plays with genre tags.`));
          }
          const hours = s.hours || [];
          drawHourChart(hourChart, hours);
          const peak = hours.reduce((best, item) => item.count > best.count ? item : best, { hour: -1, count: 0 });
          hourSheet.note.textContent = peak.count
            ? `${zh ? '峰值' : 'Peak'} ${String(peak.hour).padStart(2, '0')}:00 · ${peak.count} ${zh ? '次' : 'plays'}`
            : (zh ? '还没有时段记录' : 'No hour data yet');
          const breakdown = s.playerBreakdown || [];
          playerTable.clear(breakdown.length ? '' : (zh ? '还没有客户端归属记录' : 'No player attribution yet'));
          for (const item of breakdown) {
            playerTable.addRow([
              label(item.app),
              item.plays,
              `${Math.round((item.share || 0) * 100)}%`,
              item.days,
              item.lastAt || '-',
              (item.topArtists || []).map(artist => `${artist.name}（${artist.count}）`).join('、') || '-',
            ]);
          }
          breakdownSheet.note.textContent = breakdown.length
            ? `${breakdown.length} ${zh ? '个客户端' : 'clients'}`
            : (zh ? '还没有客户端归属记录' : 'No player attribution yet');
          const artists = s.topArtists || [];
          bars(artistTable, artists, (item, plays) => [ui.chip(String(artists.indexOf(item) + 1), 'plain'), item.name, plays],
            zh ? '还没有常听歌手' : 'No top artists yet');
          artistSheet.note.textContent = artists.length ? `${artists.length} ${zh ? '位歌手' : 'artists'}` : (zh ? '还没有常听歌手' : 'No top artists yet');
          const genres = s.topGenres || [];
          drawGenrePie(genres);
          genreTable.clear(genres.length ? '' : (zh ? '还没有曲风数据' : 'No genre data yet'));
          const genreMax = Math.max(1, ...genres.map(item => item.count));
          genres.forEach((item, index) => {
            const chip = ui.chip(String(index + 1), 'plain');
            if (index < 5) {
              chip.style.background = PALETTE[index % PALETTE.length];
              chip.style.color = '#fff';
            }
            const progress = ui.progress({ value: item.count, max: genreMax, tone: 'plain', format: value => String(value) });
            genreTable.addRow([chip, item.name, progress.el, `${Math.round((item.share || 0) * 100)}%`]);
          });
          genreSheet.note.textContent = genres.length
            ? `${zh ? '饼图前' : 'Pie top'} ${Math.min(5, genres.length)} · ${genres.length} ${zh ? '种曲风' : 'genres'}`
            : (zh ? '还没有曲风数据' : 'No genre data yet');
          const repeats = s.repeatTracks || [];
          bars(repeatTable, repeats, (item, plays) => [ui.chip(String(repeats.indexOf(item) + 1), 'plain'), item.title, item.artist || '-', plays],
            zh ? '还没有循环曲' : 'No repeat tracks yet');
          repeatSheet.note.textContent = repeats.length ? `${repeats.length} ${zh ? '首循环曲' : 'repeat tracks'}` : (zh ? '还没有循环曲' : 'No repeat tracks yet');
          const players = s.players || [];
          drawPie(players);
          playerSheet.note.textContent = players.length ? `${players.length} ${zh ? '个播放器' : 'players'}` : (zh ? '还没有播放器记录' : 'No player data yet');
          tasteHost.replaceChildren();
          const tags = s.tasteTags || [];
          if (tags.length) {
            const pills = ui.h('div');
            for (const tag of tags) pills.append(ui.pill(tag, 'plain'));
            tasteHost.append(pills);
          }
          if (s.summary) tasteHost.append(ui.h('div', 'tdesc', s.summary));
          const prefs = s.preferences || {};
          tasteHost.append(ui.h('div', 'tdesc', zh
            ? `明确偏好 ${prefs.count ?? 0} 条 · 互动频率 ${prefs.interactionLabel || '正常'} · 单曲笔记 ${s.totals?.notes ?? '—'} · 听感与曲风标签 ${s.totals?.tags ?? '—'}`
            : `Explicit preferences ${prefs.count ?? 0} · cadence ${prefs.interactionLabel || 'normal'} · notes ${s.totals?.notes ?? '—'} · tags ${s.totals?.tags ?? '—'}`));
          const empty = s.status === 'empty' || s.status === 'unavailable';
          note.classList.toggle('bad', s.status === 'unavailable');
          note.textContent = s.status === 'unavailable'
            ? (zh ? '听歌记录未启用' : 'Listening log unavailable')
            : empty
              ? (zh ? '还没有足够的听歌记录，先听几首再看画像' : 'Not enough listening data yet')
              : cumulative
                ? (zh
                  ? `累计 ${s.totalPlays ?? 0} 次播放 · 逐日记录从本次更新后开始 · 更新于 ${new Date(s.updatedAt).toLocaleTimeString()}`
                  : `${s.totalPlays ?? 0} all-time plays · per-day logging starts now · updated ${new Date(s.updatedAt).toLocaleTimeString()}`)
                : (zh
                  ? `窗口 ${s.all ? '全部' : `${s.windowDays} 天`} · 共 ${s.totalPlays ?? 0} 次播放 · 更新于 ${new Date(s.updatedAt).toLocaleTimeString()}`
                  : `${s.all ? 'All time' : `${s.windowDays} days`} · ${s.totalPlays ?? 0} plays · updated ${new Date(s.updatedAt).toLocaleTimeString()}`);
        };
        const download = (name, content, type) => {
          const blob = new Blob([content], { type });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = name;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        };
        const exportData = kind => {
          const snapshot = lastSnapshot || {};
          const month = monthData || { month: monthValue, days: [] };
          if (kind === 'json') {
            download(`listening-profile-${monthValue}.json`,
              JSON.stringify({ profile: snapshot, month }, null, 2), 'application/json');
            return;
          }
          const rows = [['date', 'plays', 'track', 'artist', 'album', 'count', 'players']];
          const days = month.days || [];
          if (!days.length) rows.push([monthValue, '', '', '', '', '', '']);
          for (const day of days) {
            if (!day.tracks?.length) {
              rows.push([day.date, day.plays, '', '', '', '', '']);
              continue;
            }
            for (const track of day.tracks) {
              rows.push([day.date, day.plays, track.title || '', track.artist || '', track.album || '', track.count,
                (track.players || []).map(player => `${player.app}:${player.count}`).join('|')]);
            }
          }
          const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\r\n');
          download(`listening-${monthValue}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
        };
        const shiftMonth = delta => {
          const [year, month] = monthValue.split('-').map(Number);
          const next = new Date(year, month - 1 + delta, 1);
          monthValue = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
          void loadMonth();
        };
        const drawMonthBar = () => {
          monthBar.replaceChildren();
          const [year, month] = monthValue.split('-').map(Number);
          const prev = ui.button('‹', { size: 'sm', onClick: () => shiftMonth(-1) });
          const next = ui.button('›', { size: 'sm', onClick: () => shiftMonth(1) });
          const title = ui.h('span', '', `${year} ${zh ? '年' : '/'} ${month} ${zh ? '月' : ''}`);
          title.style.fontWeight = '600';
          const thisMonth = ui.button(zh ? '本月' : 'This month', { size: 'sm', onClick: () => {
            const now = new Date();
            monthValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            void loadMonth();
          } });
          monthBar.append(prev, title, next, ui.h('span', 'grow'), thisMonth);
        };
        const openDay = async date => {
          selectedDate = date;
          drawMonthCalendar(dayChart, monthValue, monthData?.days || [], selectedDate, openDay);
          try {
            dayData = await ctx.invoke('day', [date]);
          } catch {
            dayData = null;
          }
          drawDayDetail(dayDetail, dayData, zh);
        };
        loadMonth = async () => {
          drawMonthBar();
          let failure = '';
          try {
            monthData = await ctx.invoke('calendar', [monthValue]);
          } catch (e) {
            monthData = null;
            failure = e instanceof Error ? e.message : String(e);
          }
          selectedDate = '';
          dayData = null;
          const days = monthData?.days || [];
          drawMonthCalendar(dayChart, monthValue, days, '', openDay);
          drawDayDetail(dayDetail, null, zh);
          // 读取失败不能显示成「没有记录」，否则日历出错会被当成没听歌。
          daySheet.note.classList.toggle('bad', !!failure);
          daySheet.note.textContent = failure
            || (days.length
              ? `${days.length} ${zh ? '天有记录' : 'recorded days'} · ${monthData.totalPlays ?? 0} ${zh ? '次' : 'plays'}`
              : (zh ? '这个月还没有逐日记录' : 'No daily records this month'));
        };
        refresh = async () => {
          try {
            draw(await ctx.invoke('snapshot', [windowValue]));
          } catch (e) {
            note.classList.add('bad');
            note.textContent = e instanceof Error ? e.message : String(e);
          }
        };
        void refresh();
        void loadMonth();
        ctx.interval(() => void refresh(), 15000);
      },
    },
    'data-overview': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const info = ui.h('div', 'tdesc', zh ? '正在统计本机数据文件…' : 'Reading local data files…');
        const memoryLine = ui.h('div', 'tdesc', zh ? '正在读取记忆位置…' : 'Reading memory location…');
        const migrationLine = ui.h('div', 'tdesc', '');
        const migrationButton = ui.button(zh ? '把本机记忆迁到当前位置' : 'Move local memory here', {
          size: 'sm', onClick: () => void migrate(),
        });
        migrationButton.style.display = 'none';
        const migrationBar = ui.rowbar();
        migrationBar.append(ui.h('span', 'grow'), migrationButton);
        const importInput = ui.input({ type: 'text', placeholder: zh ? '要导入的记忆文件夹' : 'Folder to import' });
        importInput.style.flex = '1';
        const importPick = ui.button(zh ? '选择文件夹' : 'Choose folder', { size: 'sm', onClick: () => void pickImport() });
        const importPreviewButton = ui.button(zh ? '预览' : 'Preview', { size: 'sm', onClick: () => void previewImport() });
        const importBar = ui.rowbar();
        importBar.append(importInput, importPick, importPreviewButton);
        const importNote = ui.msgline('');
        const importTable = ui.table({
          head: zh ? ['文件', '来源', '当前', '合并后'] : ['File', 'Source', 'Current', 'Merged'],
          maxHeight: '22vh',
        });
        const importMerge = ui.button(zh ? '合并导入' : 'Merge import', { size: 'sm', onClick: () => void runImport('merge') });
        const importReplace = ui.button(zh ? '替换导入' : 'Replace import', { variant: 'danger', size: 'sm', onClick: () => void runImport('replace') });
        importMerge.disabled = true;
        importReplace.disabled = true;
        const importActions = ui.rowbar();
        importActions.append(ui.h('span', 'grow'), importMerge, importReplace);
        const summary = ui.h('div');
        const table = ui.table({
          head: zh ? ['文件', '内容', '大小', '位置'] : ['File', 'Content', 'Size', 'Location'],
          maxHeight: '46vh',
        });
        const bar = ui.rowbar();
        const note = ui.msgline('');
        const refresh = ui.button(zh ? '刷新' : 'Refresh', { size: 'sm', onClick: () => void load() });
        bar.append(ui.h('span', 'grow'), refresh);
        ctx.root.append(info, memoryLine, migrationLine, migrationBar, ui.h('div', 'tdesc', zh
          ? '导入记忆：把另一个文件夹里的听歌记录、笔记、标签、偏好、口味档案与想听清单并进当前记忆目录。合并会保留两边，替换会用来源覆盖（先自动备份当前文件）。'
          : 'Import: merge listening log, notes, tags, preferences, taste file and wish list from another folder. Merge keeps both sides; replace overwrites after backing up the current files.'),
        importBar, importNote, importTable.el, importActions, summary, table.el, bar, ui.h('div', 'tdesc', zh
          ? '只读展示，不提供清除。只有「听歌记录」会被「数据清理」按保留天数删除；口味档案、想听清单、偏好、口味快照、单曲笔记与听感标签只存很小的文本，不参与清理。'
          : 'Read-only; nothing here clears data. Only the listening log is pruned by Data cleanup; the taste file, wish list, preferences, taste snapshot, notes and tags are tiny text files and are never cleaned.'), note);

        const size = bytes => {
          if (bytes === null || bytes === undefined) return '—';
          if (bytes < 1024) return `${bytes} B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
          return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        };
        let replaceArmed = false;
        const pickImport = async () => {
          try {
            const picked = await ctx.pickPath({
              kind: 'directory',
              title: zh ? '选择要导入的记忆文件夹' : 'Choose memory folder to import',
              currentPath: importInput.value.trim() || undefined,
            });
            if (!picked) return;
            importInput.value = picked;
            await previewImport();
          } catch (e) {
            importNote.classList.add('bad');
            importNote.textContent = e instanceof Error ? e.message : String(e);
          }
        };
        const previewImport = async () => {
          importMerge.disabled = true;
          importReplace.disabled = true;
          replaceArmed = false;
          importReplace.textContent = zh ? '替换导入' : 'Replace import';
          importTable.clear('');
          try {
            const p = await ctx.invoke('importPreview', [importInput.value.trim()]);
            importNote.classList.toggle('bad', p.status !== 'ok');
            importNote.textContent = p.note || '';
            if (p.status !== 'ok') return;
            for (const file of p.files)
              importTable.addRow([file.label, file.source, file.current, file.mergeable ? file.merged : '—']);
            importMerge.disabled = false;
            importReplace.disabled = false;
          } catch (e) {
            importNote.classList.add('bad');
            importNote.textContent = e instanceof Error ? e.message : String(e);
          }
        };
        const runImport = async mode => {
          const source = importInput.value.trim();
          if (!source) {
            importNote.classList.add('bad');
            importNote.textContent = zh ? '请先选择要导入的文件夹' : 'Choose a folder first';
            return;
          }
          if (mode === 'replace' && !replaceArmed) {
            replaceArmed = true;
            importReplace.textContent = zh ? '再点一次确认替换' : 'Click again to confirm';
            importNote.classList.remove('bad');
            importNote.textContent = zh
              ? '替换会用来源覆盖当前同名文件，当前文件会先备份到记忆目录的 import-backup 下。再点一次「替换导入」才会执行。'
              : 'Replace overwrites current files; they are backed up under import-backup first. Click the button again to proceed.';
            return;
          }
          importMerge.disabled = true;
          importReplace.disabled = true;
          try {
            const result = await ctx.invoke('importMemory', [source, mode]);
            importNote.classList.toggle('bad', result.status !== 'ok');
            importNote.textContent = [result.note, result.backup ? `${zh ? '备份' : 'Backup'}：${result.backup}` : ''].filter(Boolean).join(' · ');
            replaceArmed = false;
            importReplace.textContent = zh ? '替换导入' : 'Replace import';
            if (result.status === 'ok') await load();
          } catch (e) {
            importNote.classList.add('bad');
            importNote.textContent = e instanceof Error ? e.message : String(e);
          }
        };
        const migrate = async () => {
          migrationButton.disabled = true;
          try {
            const result = await ctx.invoke('migrate', []);
            migrationLine.classList.toggle('bad', result.status !== 'ok' || !result.marked);
            migrationLine.textContent = result.note || (zh ? '没有可迁移的内容' : 'Nothing to migrate');
            await load();
            if (result.marked) {
              note.classList.remove('bad');
              note.textContent = zh
                ? '迁移完成：本机旧目录不再参与读取，另一台机器不受影响。'
                : 'Moved. This machine now reads only the new folder; other machines are unaffected.';
            }
          } catch (e) {
            migrationLine.classList.add('bad');
            migrationLine.textContent = e instanceof Error ? e.message : String(e);
          } finally {
            migrationButton.disabled = false;
          }
        };
        const load = async () => {
          refresh.disabled = true;
          try {
            const s = await ctx.invoke('snapshot', []);
            if (s.status === 'unavailable') {
              info.textContent = zh ? '数据文件不可用' : 'Data files unavailable';
              table.clear(zh ? '没有启用的数据文件' : 'No data files');
              summary.replaceChildren();
              migrationLine.textContent = '';
              migrationButton.style.display = 'none';
              return;
            }
            info.textContent = zh
              ? `本插件在本机共 ${s.files.length} 个数据文件 · ${size(s.totalBytes)} · 更新于 ${new Date().toLocaleTimeString()}`
              : `${s.files.length} local data files · ${size(s.totalBytes)} · updated ${new Date().toLocaleTimeString()}`;
            const memory = s.memory || {};
            memoryLine.classList.toggle('bad', !!memory.problem);
            const kind = memory.custom
              ? (zh ? '自定义目录，可跨机器共用' : 'custom folder, shared across machines')
              : (zh ? '本机默认' : 'local default');
            memoryLine.textContent = `${zh ? '记忆位置' : 'Memory location'}：${memory.dir || '—'}（${kind}）`
              + (memory.problem ? ` · ${memory.problem}` : '')
              + (memory.fallback ? ` · ${zh ? '刚才有一次没写进自定义目录，已回落到本机' : 'one write fell back to local'}` : '');
            const migration = s.migration || {};
            migrationLine.classList.remove('bad');
            migrationLine.textContent = migration.status === 'local' ? '' : (migration.note || '');
            migrationButton.style.display = migration.status === 'ready' && migration.needed && migration.canMark ? '' : 'none';
            summary.replaceChildren(ui.statgrid([
              { k: zh ? '合计占用' : 'Total size', v: size(s.totalBytes), accent: true },
              { k: zh ? '数据文件' : 'Data files', v: s.files.length, unit: zh ? '个' : 'files' },
              { k: zh ? '参与清理' : 'Pruned', v: 1, unit: zh ? '个（听歌记录）' : '(listening log)' },
            ]));
            table.clear(s.files.length ? '' : (zh ? '没有启用的数据文件' : 'No data files'));
            for (const file of s.files) {
              const label = ui.h('span', '', file.label);
              if (file.cleanup) {
                label.append(' ', ui.chip(zh ? '可清理' : 'Prunable', 'plain'));
              }
              table.addRow([label, file.stat || '—', size(file.bytes), file.location || '—']);
            }
            note.classList.remove('bad');
            note.textContent = zh
              ? '听歌记录删除后无法恢复；其余文件体积很小，保留即可。'
              : 'Deleted listening records cannot be restored; the other files are tiny and can stay.';
          } catch (e) {
            note.classList.add('bad');
            note.textContent = e instanceof Error ? e.message : String(e);
          } finally {
            refresh.disabled = false;
          }
        };
        void load();
      },
    },
    'data-cleanup': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        let keep = '90';
        let schedulePreview = () => {};
        const info = ui.h('div', 'tdesc', zh ? '正在读取听歌记录…' : 'Reading listening log…');
        const preview = ui.msgline('');
        const note = ui.msgline('');
        const custom = ui.input({ type: 'number', value: '180' });
        custom.min = '1';
        custom.max = '36500';
        custom.step = '1';
        custom.style.display = 'none';
        custom.style.width = '96px';
        const options = ui.segmented([
          { value: '7', label: zh ? '7 天' : '7d' },
          { value: '30', label: zh ? '30 天' : '30d' },
          { value: '90', label: zh ? '90 天' : '90d' },
          { value: '365', label: zh ? '365 天' : '365d' },
          { value: 'custom', label: zh ? '自定义' : 'Custom' },
        ], {
          value: '90', size: 'sm',
          onSelect: value => {
            keep = value;
            custom.style.display = value === 'custom' ? '' : 'none';
            schedulePreview();
          },
        });
        const run = ui.button(zh ? '清理' : 'Clean up', { variant: 'danger', onClick: () => void prune() });
        const bar = ui.rowbar();
        bar.append(options.el, custom, ui.h('span', 'grow'), run);
        ctx.root.append(info, bar, ui.h('div', 'tdesc', zh
          ? '清理后无法恢复：只保留所选天数内的听歌记录（含今天），更早的逐日历史与对应累计排名会删除，听歌口味随后按剩余记录重新生成。只清理 listening.json；其他数据文件（偏好、口味快照、笔记、听感标签）体积很小，不参与清理。'
          : 'Irreversible: only records within the selected days (today included) are kept; older days and their ranking entries are deleted, then the taste snapshot is rebuilt from what remains. Only listening.json is pruned; the other data files (preferences, taste snapshot, notes, tags) are tiny and never cleaned.'), preview, note);

        const keepDays = () => {
          if (keep !== 'custom') return Number(keep);
          const value = Math.floor(Number(custom.value));
          return Number.isFinite(value) && value >= 1 ? Math.min(36500, value) : null;
        };
        const fail = message => {
          note.classList.add('bad');
          note.textContent = message;
        };
        let previewTimer = 0;
        const loadPreview = async () => {
          const days = keepDays();
          if (!days) {
            preview.classList.add('bad');
            preview.textContent = zh ? '自定义保留天数需为 1–36500' : 'Custom retention must be 1–36500 days';
            return;
          }
          try {
            const p = await ctx.invoke('preview', [days]);
            if (ctx.signal.aborted) return;
            if (p.status === 'unavailable') {
              preview.classList.add('bad');
              preview.textContent = zh ? '听歌记录未启用' : 'Listening log unavailable';
              return;
            }
            preview.classList.remove('bad');
            preview.textContent = p.removedDays
              ? (zh
                ? `将清理 ${p.removedDays} 天（${p.removedPlays} 次播放），保留 ${p.keptDays} 天（${p.keptPlays} 次播放）`
                : `Will remove ${p.removedDays} days (${p.removedPlays} plays); keeping ${p.keptDays} days (${p.keptPlays} plays)`)
              : (zh
                ? `没有会被清理的记录（现有 ${p.keptDays} 天 / ${p.keptPlays} 次播放）`
                : `Nothing would be removed (${p.keptDays} days / ${p.keptPlays} plays now)`);
          } catch (e) {
            preview.classList.add('bad');
            preview.textContent = e instanceof Error ? e.message : String(e);
          }
        };
        schedulePreview = () => {
          clearTimeout(previewTimer);
          previewTimer = setTimeout(() => void loadPreview(), 200);
        };
        custom.addEventListener('input', () => schedulePreview());
        ctx.signal.addEventListener('abort', () => clearTimeout(previewTimer));
        const load = async () => {
          try {
            const s = await ctx.invoke('snapshot', []);
            if (s.status === 'unavailable') {
              info.textContent = zh ? '听歌记录未启用' : 'Listening log unavailable';
              run.disabled = true;
              return;
            }
            run.disabled = s.status === 'empty';
            info.textContent = s.status === 'empty'
              ? (zh ? '还没有听歌记录' : 'No listening records yet')
              : s.days === 0 && s.plays > 0
                ? (zh
                  ? `只有累计 ${s.plays} 次播放（${s.tracks} 首歌 / ${s.artists} 位歌手）；逐日记录从更新后开始，清理只作用于逐日历史`
                  : `Only ${s.plays} all-time plays (${s.tracks} songs / ${s.artists} artists); per-day logging starts with this update, so cleanup only affects per-day history`)
                : (zh
                  ? `当前 ${s.days} 天记录 · ${s.plays} 次播放 · ${s.tracks} 首歌 / ${s.artists} 位歌手${s.oldest ? ` · 最早 ${s.oldest}` : ''}`
                  : `${s.days} days · ${s.plays} plays · ${s.tracks} songs / ${s.artists} artists${s.oldest ? ` · oldest ${s.oldest}` : ''}`);
            void loadPreview();
          } catch (e) {
            fail(e instanceof Error ? e.message : String(e));
          }
        };
        const prune = async () => {
          const days = keepDays();
          if (!days) {
            fail(zh ? '自定义保留天数需为 1–36500' : 'Custom retention must be 1–36500 days');
            return;
          }
          const ok = await ui.confirm({
            title: zh ? '清理听歌记录' : 'Clean listening log',
            body: zh
              ? `只保留最近 ${days} 天的听歌记录，更早的逐日历史与对应排名会删除，且无法恢复。`
              : `Keep only the last ${days} days of listening records. Older days and their ranking entries will be deleted permanently.`,
            danger: true,
          });
          if (!ok || ctx.signal.aborted) return;
          try {
            const result = await ctx.invoke('prune', [days]);
            note.classList.remove('bad');
            note.textContent = result.removedDays
              ? (zh
                ? `已清理 ${result.removedDays} 天记录（${result.removedPlays} 次播放），保留最近 ${result.keepDays} 天 · 现有 ${result.keptDays} 天 / ${result.keptPlays} 次播放`
                : `Removed ${result.removedDays} days (${result.removedPlays} plays); kept the last ${result.keepDays} days · ${result.keptDays} days / ${result.keptPlays} plays remain`)
              : (zh
                ? `没有早于保留期的记录，未删除数据（现有 ${result.keptDays} 天 / ${result.keptPlays} 次播放）`
                : `Nothing older than the retention window; no data removed (${result.keptDays} days / ${result.keptPlays} plays remain)`);
            await load();
          } catch (e) {
            fail(e instanceof Error ? e.message : String(e));
          }
        };
        void load();
      },
    },
  },
};
