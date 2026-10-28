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
          invalidRegex: zh ? '正则表达式无效，未保存' : 'Invalid regular expression; not saved',
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
            case 'reader':
              return zh
                ? `窗口降级 ${onOff(get('windowFallback'))} · SMTC 正则 ${get('sessionPattern') ? '已设置' : '—'}`
                : `Window fallback ${onOff(get('windowFallback'))} · SMTC pattern ${get('sessionPattern') ? 'set' : '—'}`;
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
            if ((reader.key === 'sessionPattern' || reader.key === 'windowFallbackProcess')
              && typeof value === 'string') {
              try { new RegExp(value); }
              catch { invalid(text.invalidRegex); return; }
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
          if (field.type === 'string') {
            const input = ui.input({
              type: 'text',
              value: field.value == null ? '' : String(field.value),
              cls: field.key === 'sessionPattern' || field.key === 'windowFallbackProcess' ? 'mono' : undefined,
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
          sessions: zh ? '当前 SMTC 会话' : 'SMTC sessions',
          sessionsDesc: zh ? 'Windows 当前暴露的媒体会话，未匹配到音乐软件时也会列在这里' : 'Media sessions Windows currently exposes, including apps outside the music filter',
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
          head: zh ? ['应用', '状态', '曲目', '歌手'] : ['App', 'State', 'Track', 'Artist'],
          maxHeight: '28vh',
        });
        const sessionSection = ui.section(text.sessions, text.sessionsDesc);
        sessionSection.append(sessions.el);
        bar.append(ui.h('span', 'grow'), ui.button(text.recheck, { size: 'sm', onClick: () => void load() }));
        ctx.root.append(bar, summary, appsHost, sessionSection, status);

        let state = { apps: [], sessions: [], error: '' };

        const appName = app => app.id === 'netease' ? (zh ? '网易云音乐' : 'NetEase Cloud Music') : (zh ? 'QQ 音乐' : 'QQ Music');
        const hasSession = app => {
          const pattern = app.id === 'netease' ? /cloudmusic|netease/i : /qqmusic/i;
          return (state.sessions || []).some(session => pattern.test(String(session.app || '')));
        };
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
          return app.id === 'qqmusic' ? text.qqHint : text.neteaseHint;
        };

        const draw = data => {
          state = {
            apps: Array.isArray(data?.apps) ? data.apps : [],
            sessions: Array.isArray(data?.sessions) ? data.sessions : [],
            error: data?.error ? String(data.error) : '',
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
            sheet.body.appendChild(pills);
            if (app.path) sheet.body.appendChild(ui.h('div', 'tdesc', String(app.path)));
            sheet.body.appendChild(ui.h('div', 'tdesc', hint(app)));
            appsHost.appendChild(sheet.el);
          }
          sessions.clear(state.sessions.length ? '' : text.empty);
          for (const session of state.sessions) {
            sessions.addRow([session.app || '-', stateLabel(session.status), session.title || '-', session.artist || '-']);
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
        bar.append(windows.el, ui.chip(zh ? '从听歌记录汇总' : 'From listening log', 'plain'));

        const statsHost = ui.h('div');
        const hourChart = ui.h('div');
        const dayChart = ui.h('div');
        const artistTable = ui.table({ head: zh ? ['#', '歌手', '播放'] : ['#', 'Artist', 'Plays'], maxHeight: '26vh' });
        const genreTable = ui.table({ head: zh ? ['#', '曲风', '播放', '占比'] : ['#', 'Genre', 'Plays', 'Share'], maxHeight: '26vh' });
        const repeatTable = ui.table({ head: zh ? ['#', '歌曲', '歌手', '播放'] : ['#', 'Song', 'Artist', 'Plays'], maxHeight: '26vh' });
        const playerPie = ui.h('div');
        const genrePie = ui.h('div');
        const playerLegend = ui.h('div');
        const playerHost = ui.h('div');
        const tasteHost = ui.h('div');

        const hourSheet = ui.foldSheet('profile-hours', { title: zh ? '时段分布' : 'Listening hours', desc: zh ? '按 24 小时汇总播放次数，不做人格判断' : 'Plays by hour of day', defaultOpen: true });
        hourSheet.body.append(hourChart);
        const daySheet = ui.foldSheet('profile-days', { title: zh ? '每日播放' : 'Daily plays', desc: zh ? '最近有记录的日期与播放次数；没有播放的日期不显示' : 'Recent recorded days and play counts; silent days are omitted', defaultOpen: true });
        daySheet.body.append(dayChart);
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
        const tasteSheet = ui.foldSheet('profile-taste', { title: zh ? '口味画像' : 'Taste profile', desc: zh ? '只根据本机听歌记录和明确偏好，不做人格定论' : 'From local listening data and explicit preferences only', defaultOpen: true });
        tasteSheet.body.append(tasteHost);

        ctx.root.append(statsHost, bar, hourSheet.el, daySheet.el, artistSheet.el, genreSheet.el, repeatSheet.el, playerSheet.el, tasteSheet.el, note);

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
        const chart = (host, items, options) => {
          host.replaceChildren();
          if (!items.length) {
            host.append(ui.h('div', 'tdesc', options.empty));
            return;
          }
          const wrap = ui.h('div');
          wrap.style.display = 'flex';
          wrap.style.alignItems = 'flex-end';
          wrap.style.gap = '3px';
          wrap.style.padding = '8px 2px 0';
          wrap.style.minHeight = '160px';
          const max = Math.max(1, ...items.map(item => item.count));
          for (const item of items) {
            const col = ui.h('div');
            col.style.flex = '1';
            col.style.minWidth = '4px';
            col.style.display = 'flex';
            col.style.flexDirection = 'column';
            col.style.alignItems = 'center';
            col.title = `${options.title(item)} · ${item.count}`;
            const area = ui.h('div');
            area.style.width = '100%';
            area.style.height = '128px';
            area.style.display = 'flex';
            area.style.alignItems = 'flex-end';
            const fill = ui.h('div');
            fill.style.width = '100%';
            fill.style.height = '0';
            fill.style.background = options.color;
            fill.style.borderRadius = '3px 3px 0 0';
            fill.style.transition = 'height .7s cubic-bezier(.2,.8,.2,1)';
            area.append(fill);
            const lab = ui.h('div');
            lab.textContent = options.label(item);
            lab.style.fontSize = '9px';
            lab.style.opacity = '.55';
            lab.style.marginTop = '4px';
            lab.style.whiteSpace = 'nowrap';
            col.append(area, lab);
            wrap.append(col);
            requestAnimationFrame(() => {
              fill.style.height = `${Math.round((item.count / max) * 100)}%`;
            });
          }
          host.append(wrap);
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
          const cumulative = s.scope === 'cumulative';
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
          }
          const hours = s.hours || [];
          chart(hourChart, hours.map(item => ({
            ...item,
            label: item.hour % 3 === 0 ? String(item.hour) : '',
          })), {
            label: item => item.label,
            title: item => `${String(item.hour).padStart(2, '0')}:00`,
            color: 'var(--accent, #5b8cff)',
            empty: zh ? '还没有时段记录' : 'No hour data yet',
          });
          const peak = hours.reduce((best, item) => item.count > best.count ? item : best, { hour: -1, count: 0 });
          hourSheet.note.textContent = peak.count
            ? `${zh ? '峰值' : 'Peak'} ${String(peak.hour).padStart(2, '0')}:00 · ${peak.count} ${zh ? '次' : 'plays'}`
            : (zh ? '还没有时段记录' : 'No hour data yet');
          const days = (s.daily || []).slice(-14).map(item => ({ ...item, count: item.plays }));
          chart(dayChart, days, {
            label: item => item.date.slice(5),
            title: item => item.date,
            color: '#4cc38a',
            empty: zh ? '还没有逐日记录' : 'No daily data yet',
          });
          daySheet.note.textContent = days.length
            ? `${days.length} ${zh ? '个有记录的日期' : 'recorded days'}`
            : (zh ? '还没有逐日记录' : 'No daily data yet');
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
        refresh = async () => {
          try {
            draw(await ctx.invoke('snapshot', [windowValue]));
          } catch (e) {
            note.classList.add('bad');
            note.textContent = e instanceof Error ? e.message : String(e);
          }
        };
        void refresh();
        ctx.interval(() => void refresh(), 15000);
      },
    },
    'data-overview': {
      mount(ctx) {
        const ui = ctx.ui;
        const zh = String(ctx.language ?? 'zh').startsWith('zh');
        const info = ui.h('div', 'tdesc', zh ? '正在统计本机数据文件…' : 'Reading local data files…');
        const summary = ui.h('div');
        const table = ui.table({
          head: zh ? ['文件', '内容', '大小', '位置'] : ['File', 'Content', 'Size', 'Location'],
          maxHeight: '46vh',
        });
        const bar = ui.rowbar();
        const note = ui.msgline('');
        const refresh = ui.button(zh ? '刷新' : 'Refresh', { size: 'sm', onClick: () => void load() });
        bar.append(ui.h('span', 'grow'), refresh);
        ctx.root.append(info, summary, table.el, bar, ui.h('div', 'tdesc', zh
          ? '只读展示，不提供清除。只有「听歌记录」会被「数据清理」按保留天数删除；偏好、口味快照、单曲笔记与听感标签只存很小的文本，不参与清理。'
          : 'Read-only; nothing here clears data. Only the listening log is pruned by Data cleanup; preferences, taste snapshot, notes and tags are tiny text files and are never cleaned.'), note);

        const size = bytes => {
          if (bytes === null || bytes === undefined) return '—';
          if (bytes < 1024) return `${bytes} B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
          return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        };
        const load = async () => {
          refresh.disabled = true;
          try {
            const s = await ctx.invoke('snapshot', []);
            if (s.status === 'unavailable') {
              info.textContent = zh ? '数据文件不可用' : 'Data files unavailable';
              table.clear(zh ? '没有启用的数据文件' : 'No data files');
              summary.replaceChildren();
              return;
            }
            info.textContent = zh
              ? `本插件在本机共 ${s.files.length} 个数据文件 · ${size(s.totalBytes)} · 更新于 ${new Date().toLocaleTimeString()}`
              : `${s.files.length} local data files · ${size(s.totalBytes)} · updated ${new Date().toLocaleTimeString()}`;
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
